// src/api/v2/operations/operations.controller.js
const Plant = require('../../../models/plant.model');
const Van = require('../../../models/van.model');
const MaintenanceLog = require('../../../models/maintenanceLog.model');
const DailySummary = require('../../../models/dailySummary.model');
const Order = require('../../../models/order.model');
const DataEntry = require('../../../models/dataEntry.model');
const StockIn = require('../../../models/stockIn.model'); // ✅ NEW
const ExpenseTransaction = require('../../../models/expenseTransaction.model');
const StockMovement = require('../../../models/stockMovement.model');
const { getPlantControlSnapshot, assertValidPlant, assertOpenPeriod } = require('../control/operationalValidation.service');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');
const mongoose = require('mongoose');

// -------------------------
// Helpers
// -------------------------
const hasVal = (v) => v !== undefined && v !== null && String(v).trim() !== '';
const toNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const toDateSafe = (v) => {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const endOfDay = (d) => {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
};
const getBranchScope = (req) => {
  const branchId = req.query?.branchId || req.query?.serviceZoneId || req.body?.branchId || req.body?.serviceZoneId;
  return hasVal(branchId) ? String(branchId) : '';
};
const buildBranchOrZoneMatch = (branchKey) => {
  if (!branchKey) return {};
  const s = String(branchKey);

  const ors = [
    { branchId: s },
    { serviceZoneId: s },
    { zoneId: s },
    { plantId: s },
    { branchKey: s },
    // some schemas store plant.id directly
    { id: s },
  ];

  if (mongoose.Types.ObjectId.isValid(s)) {
    const oid = new mongoose.Types.ObjectId(s);
    ors.push({ branchId: oid }, { serviceZoneId: oid }, { zoneId: oid }, { plantId: oid });
  }

  return { $or: ors };
};

// -------------------------
// Plants (existing)
// -------------------------
const getPlants = async (req, res, next) => {
  try {
    const branchId = getBranchScope(req);
    const plantFilter = {};
    if (branchId) plantFilter.id = branchId;

    const plants = await Plant.find(plantFilter).lean();

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const plantsWithMetrics = await Promise.all(
      plants.map(async (plant) => {
        // DELIVERY revenue from orders (exclude POS channel if channel exists)
        const orderMatch = {
          branchId: plant.id,
          status: 'Delivered',
          $and: [
            {
              $or: [{ orderDate: { $gte: thirtyDaysAgo } }, { createdAt: { $gte: thirtyDaysAgo } }],
            },
            {
              $or: [{ channel: { $exists: false } }, { channel: { $ne: 'POS' } }],
            },
          ],
        };

        const [plantRevenueResult, posRevenueResult, plantExpensesResult] = await Promise.all([
          Order.aggregate([{ $match: orderMatch }, { $group: { _id: null, totalRevenue: { $sum: '$grandTotal' } } }]),
          DailySummary.aggregate([
            {
              $match: {
                branchId: plant.id,
                status: 'approved',
                date: { $gte: thirtyDaysAgo },
              },
            },
            {
              $group: {
                _id: null,
                totalRevenue: { $sum: { $ifNull: ['$sales.totalRevenue', 0] } },
                totalKgSold: { $sum: { $ifNull: ['$sales.totalKgSold', 0] } },
              },
            },
          ]),
          DataEntry.aggregate([
            {
              $match: {
                branchId: plant.id,
                type: 'expense',
                status: 'approved',
                date: { $gte: thirtyDaysAgo },
              },
            },
            { $group: { _id: null, totalExpenses: { $sum: '$amount' } } },
          ]),
        ]);

        const deliveryRevenue30d = toNum(plantRevenueResult[0]?.totalRevenue, 0);
        const posRevenue30d = toNum(posRevenueResult[0]?.totalRevenue, 0);
        const posKgSold30d = toNum(posRevenueResult[0]?.totalKgSold, 0);
        const totalPlantRevenue = deliveryRevenue30d + posRevenue30d;
        const totalPlantExpenses = toNum(plantExpensesResult[0]?.totalExpenses, 0);

        const plantProfitability = totalPlantRevenue - totalPlantExpenses;
        const expensesAsPercentageOfRevenue = totalPlantRevenue > 0 ? (totalPlantExpenses / totalPlantRevenue) * 100 : 0;

        const capacity = toNum(plant.capacity, 0);
        const outputToday = toNum(plant.outputToday, 0);
        const targetDailyOutputKg = toNum(plant.targetDailyOutputKg, 0);

        const capacityUtilizationPct = capacity > 0 ? (outputToday / capacity) * 100 : 0;
        const dailyOutputPerformancePct = targetDailyOutputKg > 0 ? (outputToday / targetDailyOutputKg) * 100 : 0;

        return {
          ...plant,
          totalPlantRevenue,
          totalPlantExpenses,
          plantProfitability,
          expensesAsPercentageOfRevenue: Number(expensesAsPercentageOfRevenue.toFixed(2)),
          deliveryRevenue30d,
          posRevenue30d,
          posKgSold30d,
          capacityUtilizationPct: Number(capacityUtilizationPct.toFixed(2)),
          dailyOutputPerformancePct: Number(dailyOutputPerformancePct.toFixed(2)),
        };
      })
    );

    res.status(200).json(plantsWithMetrics);
  } catch (error) {
    logger.error('Error fetching plant data with metrics:', error);
    next(new HttpError(500, 'Failed to fetch plant data.'));
  }
};

const addPlant = async (req, res, next) => {
  try {
    const {
      name,
      capacity,
      status,
      uptime,
      outputToday,
      monthlyOpex,
      location,
      targetDailyOutputKg,
      lastMaintenanceDate,
      nextMaintenanceDate,
    } = req.body;

    const lastMaint = hasVal(lastMaintenanceDate) ? toDateSafe(lastMaintenanceDate) : null;
    const nextMaint = hasVal(nextMaintenanceDate) ? toDateSafe(nextMaintenanceDate) : null;

    if (hasVal(lastMaintenanceDate) && !lastMaint) throw new HttpError(400, 'Invalid lastMaintenanceDate.');
    if (hasVal(nextMaintenanceDate) && !nextMaint) throw new HttpError(400, 'Invalid nextMaintenanceDate.');

    const newPlant = new Plant({
      id: new mongoose.Types.ObjectId().toString(),
      name,
      capacity: toNum(capacity, 0),
      status,
      uptime: toNum(uptime, 100),
      outputToday: toNum(outputToday, 0),
      monthlyOpex: toNum(monthlyOpex, 0),
      location,
      targetDailyOutputKg: toNum(targetDailyOutputKg, 0),
      lastMaintenanceDate: lastMaint || undefined,
      nextMaintenanceDate: nextMaint || undefined,
    });

    await newPlant.save();
    logger.info(`New plant added: ${name} with capacity ${newPlant.capacity}kg.`);
    res.status(201).json(newPlant);
  } catch (error) {
    logger.error('Error adding plant:', error);
    if (error instanceof HttpError) return next(error);
    if (error.name === 'ValidationError') return next(new HttpError(400, error.message));
    next(new HttpError(500, 'Failed to add plant.'));
  }
};

const deletePlant = async (req, res, next) => {
  try {
    const { plantId } = req.params;

    let deletedPlant = await Plant.findOneAndDelete({ id: plantId });
    if (!deletedPlant && mongoose.Types.ObjectId.isValid(plantId)) {
      deletedPlant = await Plant.findByIdAndDelete(plantId);
    }

    if (!deletedPlant) throw new HttpError(404, 'Plant not found.');

    logger.info(`Plant ${plantId} deleted successfully.`);
    res.status(200).json({ message: 'Plant deleted successfully.' });
  } catch (error) {
    logger.error(`Error deleting plant ${req.params.plantId}:`, error);
    next(error instanceof HttpError ? error : new HttpError(500, 'Failed to delete plant.'));
  }
};

// -------------------------
// Vans (existing)
// -------------------------
const getVans = async (req, res, next) => {
  try {
    const branchId = getBranchScope(req);
    const filter = {};
    if (branchId) filter.branchId = branchId;

    let vans = [];
    try {
      vans = await Van.find(filter).sort({ createdAt: -1, _id: -1 });
    } catch (e) {
      if (branchId) vans = await Van.find({}).sort({ createdAt: -1, _id: -1 });
      else throw e;
    }

    res.status(200).json(vans);
  } catch (error) {
    logger.error('Error fetching vans data:', error);
    next(new HttpError(500, 'Failed to fetch vans data.'));
  }
};

// -------------------------
// Maintenance (existing)
// -------------------------
const addMaintenanceLog = async (req, res, next) => {
  try {
    const { plantId } = req.params;
    const { type, description, startDate, endDate, cost, performedBy, status } = req.body;

    const start = toDateSafe(startDate);
    const end = hasVal(endDate) ? toDateSafe(endDate) : null;

    if (!start) throw new HttpError(400, 'Valid startDate is required.');
    if (hasVal(endDate) && !end) throw new HttpError(400, 'Invalid endDate.');

    const plant = await Plant.findOne({ id: plantId });
    if (!plant && mongoose.Types.ObjectId.isValid(plantId)) {
      // fallback to _id
      const plantById = await Plant.findById(plantId);
      if (!plantById) throw new HttpError(404, 'Plant not found.');
    } else if (!plant) {
      throw new HttpError(404, 'Plant not found.');
    }

    const newLog = new MaintenanceLog({
      id: new mongoose.Types.ObjectId().toString(),
      plantId,
      type,
      description,
      startDate: start,
      endDate: end || undefined,
      cost: toNum(cost, 0),
      performedBy,
      status,
    });

    await newLog.save();

    await Plant.findOneAndUpdate({ id: plantId }, { $set: { lastMaintenanceDate: start } }, { new: true });

    logger.info(`Maintenance log added for plant ${plantId}: ${description}`);
    res.status(201).json(newLog);
  } catch (error) {
    logger.error('Error adding maintenance log:', error);
    next(error instanceof HttpError ? error : new HttpError(500, 'Failed to add maintenance log.'));
  }
};

const getMaintenanceLogs = async (req, res, next) => {
  try {
    const { plantId } = req.params;
    const logs = await MaintenanceLog.find({ plantId }).sort({ startDate: -1, _id: -1 });
    res.status(200).json(logs);
  } catch (error) {
    logger.error(`Error fetching maintenance logs for plant ${req.params.plantId}:`, error);
    next(new HttpError(500, 'Failed to retrieve maintenance logs.'));
  }
};

// -------------------------
// Plant output history (existing)
// -------------------------
const getPlantDailyOutputHistory = async (req, res, next) => {
  try {
    const { plantId } = req.params;
    const daysRaw = parseInt(req.query.days, 10);
    const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 365) : 7;

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const history = await DailySummary.aggregate([
      {
        $match: {
          branchId: plantId,
          status: 'approved',
          date: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $project: {
          _id: 0,
          date: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
          totalKgSold: {
            $add: [
              { $subtract: [{ $ifNull: ['$closingMeters.meterA', 0] }, { $ifNull: ['$openingMeters.meterA', 0] }] },
              { $subtract: [{ $ifNull: ['$closingMeters.meterB', 0] }, { $ifNull: ['$openingMeters.meterB', 0] }] },
            ],
          },
          totalRevenue: { $ifNull: ['$sales.totalRevenue', 0] },
        },
      },
      { $sort: { date: 1 } },
    ]);

    res.status(200).json(history);
  } catch (error) {
    logger.error(`Error fetching daily output history for plant ${req.params.plantId}:`, error);
    next(new HttpError(500, 'Failed to retrieve plant daily output history.'));
  }
};

// -------------------------
// ✅ NEW: Stock-Ins (required by frontend Inventory + LogStockInModal)
// GET /api/v2/operations/stock-ins?branchId=...&startDate=...&endDate=...
// POST /api/v2/operations/stock-ins
// -------------------------
const getStockIns = async (req, res, next) => {
  try {
    const branchKey = getBranchScope(req);
    const { startDate, endDate } = req.query;

    const match = {
      ...(branchKey ? buildBranchOrZoneMatch(branchKey) : {}),
    };

    if (hasVal(startDate) && hasVal(endDate)) {
      const s = toDateSafe(startDate);
      const e = toDateSafe(endDate);
      if (!s || !e) throw new HttpError(400, 'Invalid startDate/endDate');
      match.purchaseDate = { $gte: s, $lte: endOfDay(e) };
    }

    const rows = await StockIn.find(match).sort({ purchaseDate: -1, createdAt: -1 }).limit(500).lean();
    return res.status(200).json(rows);
  } catch (error) {
    logger.error('Error fetching stock-ins:', error);
    next(error instanceof HttpError ? error : new HttpError(500, 'Failed to fetch stock-ins.'));
  }
};

const addStockIn = async (req, res, next) => {
  try {
    const {
      branchId,
      supplier,
      purchaseDate,
      quantityKg,
      costPerKg,
      targetSalePricePerKg,
      amountPaid,
      paidAmount,
      isPaid,
      paymentStatus,
    } = req.body;

    const d = toDateSafe(purchaseDate);
    if (!d) throw new HttpError(400, 'Invalid purchaseDate');

    const qty = toNum(quantityKg, 0);
    const cpk = toNum(costPerKg, 0);
    const tsp = toNum(targetSalePricePerKg, 0);
    if (qty <= 0 || cpk <= 0 || tsp <= 0) throw new HttpError(400, 'quantityKg, costPerKg, targetSalePricePerKg must be > 0');

    const doc = new StockIn({
      branchId: String(branchId),
      supplier: String(supplier || '').trim(),
      purchaseDate: d,
      quantityKg: qty,
      remainingKg: qty,
      costPerKg: cpk,
      targetSalePricePerKg: tsp,
      amountPaid: toNum(amountPaid, 0),
      paidAmount: toNum(paidAmount, 0),
      isPaid: Boolean(isPaid),
      paymentStatus: paymentStatus ? String(paymentStatus) : null,
      loggedBy: {
        uid: String(req.user?.id || req.user?._id || 'system'),
        email: String(req.user?.email || 'unknown'),
      },
    });

    await doc.save();
    return res.status(201).json(doc);
  } catch (error) {
    logger.error('Error adding stock-in:', error);
    next(error instanceof HttpError ? error : new HttpError(500, 'Failed to add stock-in.'));
  }
};


const getPlantCommandCenter = async (req, res, next) => {
  try {
    const { plantId } = req.params;
    const plant = await assertValidPlant(plantId, { requireOperational: false });
    const branchIds = [String(plant._id), plant.id].filter(Boolean);
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - Number(req.query.days || 30));
    const branchMatch = { $or: branchIds.flatMap((b) => [{ branchId: b }, { serviceZoneId: b }, { zoneId: b }, { plantId: b }]) };
    const stockBranchMatch = { $or: branchIds.map((b) => ({ branchId: b })) };
    const [snapshot, summaries, orders, expenses, maintenance, movements] = await Promise.all([
      getPlantControlSnapshot(plant.id || plant._id),
      DailySummary.find({ ...branchMatch, date: { $gte: start, $lte: now } }).lean(),
      Order.find({ ...branchMatch, $or: [{ createdAt: { $gte: start, $lte: now } }, { orderDate: { $gte: start, $lte: now } }] }).lean(),
      ExpenseTransaction.find({ ...branchMatch, date: { $gte: start, $lte: now }, status: { $nin: ['voided', 'reversed'] } }).lean(),
      MaintenanceLog.find({ plantId: { $in: branchIds } }).sort({ startDate: -1, createdAt: -1 }).limit(10).lean(),
      StockMovement.find(stockBranchMatch).sort({ movementDate: -1, createdAt: -1 }).limit(20).lean(),
    ]);
    const posRevenue = summaries.reduce((sum, row) => sum + toNum(row?.sales?.totalRevenue, 0), 0);
    const posKg = summaries.reduce((sum, row) => sum + toNum(row?.sales?.totalKgSold, 0), 0);
    const deliveryRevenue = orders.filter((row) => String(row.status).toLowerCase() === 'delivered').reduce((sum, row) => sum + toNum(row.grandTotal ?? row.totalAmount, 0), 0);
    const opex = expenses.reduce((sum, row) => sum + toNum(row.amount, 0), 0);
    const cogs = movements.filter((row) => ['SALE_DEPLETION', 'ORDER_DEPLETION'].includes(row.movementType)).reduce((sum, row) => sum + toNum(row.totalCost, 0), 0);
    const revenue = posRevenue + deliveryRevenue;
    const maintenanceOpen = maintenance.filter((row) => !['COMPLETED', 'Closed', 'closed', 'Done'].includes(String(row.status))).length;
    const lowStockThresholdKg = toNum(req.query.lowStockThresholdKg, 1000);
    const alerts = [];
    if (snapshot.stock.availableKg <= 0) alerts.push({ severity: 'CRITICAL', message: 'No available LPG stock is recorded for this plant.' });
    else if (snapshot.stock.availableKg < lowStockThresholdKg) alerts.push({ severity: 'WARNING', message: 'LPG stock is below threshold.' });
    if (maintenanceOpen > 0) alerts.push({ severity: 'WARNING', message: maintenanceOpen + ' open maintenance item(s).' });
    if (plant.status !== 'Operational') alerts.push({ severity: 'WARNING', message: 'Plant status is ' + plant.status + '.' });
    return res.json({ ok: true, plant, stock: snapshot.stock, stockConfig: snapshot.stockConfig, period: { start, end: now }, metrics: { revenue, posRevenue, deliveryRevenue, posKg, cogs, grossProfit: revenue - cogs, opex, netProfit: revenue - cogs - opex, utilizationPct: toNum(plant.capacity, 0) > 0 ? (posKg / toNum(plant.capacity, 0)) * 100 : 0, maintenanceOpen }, maintenance, movements, alerts, guide: { title: 'Plant Command Center', message: 'Use this screen to manage stock health, maintenance status, profitability, utilization and operational exceptions for each plant.' } });
  } catch (error) {
    return next(error instanceof HttpError ? error : new HttpError(500, 'Failed to load plant command center.'));
  }
};

const updatePlantStatus = async (req, res, next) => {
  try {
    const { plantId } = req.params;
    const { status, reason } = req.body || {};
    if (!['Operational', 'Maintenance', 'Offline', 'Warning'].includes(String(status))) throw new HttpError(400, 'Invalid plant status.');
    if (!reason) throw new HttpError(400, 'Reason is required when changing plant status.');
    const plant = await assertValidPlant(plantId, { requireOperational: false });
    const updated = await Plant.findOneAndUpdate({ $or: [{ id: plant.id }, { _id: plant._id }] }, { $set: { status } }, { new: true });
    return res.json({ ok: true, plant: updated, message: 'Plant status updated.' });
  } catch (error) {
    return next(error instanceof HttpError ? error : new HttpError(500, 'Failed to update plant status.'));
  }
};

module.exports = {
  getPlants,
  addPlant,
  deletePlant,
  getVans,
  addMaintenanceLog,
  getMaintenanceLogs,
  getPlantDailyOutputHistory,

  // ✅ NEW
  getStockIns,
  addStockIn,
  getPlantCommandCenter,
  updatePlantStatus,
};