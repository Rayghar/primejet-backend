// src/api/v2/plant-reliability/plantReliability.controller.js
const Plant = require('../../../models/plant.model');
const MaintenanceLog = require('../../../models/maintenanceLog.model');
const Asset = require('../../../models/asset.model');
const DailySummary = require('../../../models/dailySummary.model');
const StockMovement = require('../../../models/stockMovement.model');
const SupportTicket = require('../../../models/supportTicket.model');
const PlantSafetyCheck = require('../../../models/plantSafetyCheck.model');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');

const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const round = (n, dp = 2) => Math.round(num(n) * 10 ** dp) / 10 ** dp;
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(0,0,0,0); return d; };

const getStockPosition = async (plantId) => {
  const rows = await StockMovement.aggregate([
    { $match: { branchId: String(plantId) } },
    { $sort: { movementDate: 1, createdAt: 1 } },
    { $group: { _id: '$branchId', inKg: { $sum: { $cond: [{ $eq: ['$direction','IN'] }, '$quantityKg', 0] } }, outKg: { $sum: { $cond: [{ $eq: ['$direction','OUT'] }, '$quantityKg', 0] } }, lastMovementAt: { $max: '$movementDate' }, lastRunningValue: { $last: '$runningValue' } } },
  ]).catch(() => []);
  const r = rows[0] || {};
  const currentKg = Math.max(0, num(r.inKg) - num(r.outKg));
  return { currentKg: round(currentKg), inKg: round(r.inKg), outKg: round(r.outKg), stockValue: round(r.lastRunningValue), lastMovementAt: r.lastMovementAt || null };
};

const getPlantProfitability = async (plantId) => {
  const since = daysAgo(30);
  const rows = await DailySummary.aggregate([
    { $match: { branchId: String(plantId), date: { $gte: since } } },
    { $group: { _id: '$branchId', revenue: { $sum: { $ifNull: ['$sales.totalRevenue', 0] } }, kg: { $sum: { $ifNull: ['$sales.totalKgSold', 0] } }, expenses: { $sum: { $ifNull: ['$expenses.total', 0] } }, days: { $sum: 1 } } },
  ]).catch(() => []);
  const r = rows[0] || {};
  return { revenue30d: round(r.revenue), kg30d: round(r.kg), opex30d: round(r.expenses), grossProfit30d: round(num(r.revenue) - num(r.expenses)), activeDays30d: num(r.days) };
};

const getReliabilityForPlant = async (plant) => {
  const plantId = String(plant.id || plant._id);
  const [stock, profitability, maintenance, safety, tickets] = await Promise.all([
    getStockPosition(plantId),
    getPlantProfitability(plantId),
    MaintenanceLog.find({ plantId }).sort({ startDate: -1 }).limit(5).lean().catch(() => []),
    PlantSafetyCheck.find({ plantId }).sort({ checkDate: -1 }).limit(5).lean().catch(() => []),
    SupportTicket.countDocuments({ status: { $in: ['OPEN','IN_PROGRESS','ESCALATED'] }, $or: [{ 'meta.plantId': plantId }, { plantId }] }).catch(() => 0),
  ]);
  const capacity = num(plant.capacity);
  const utilizationPct = capacity ? (num(plant.outputToday) / capacity) * 100 : 0;
  const daysOfCover = profitability.kg30d > 0 ? stock.currentKg / (profitability.kg30d / 30) : null;
  const overdueMaintenance = plant.nextMaintenanceDate ? new Date(plant.nextMaintenanceDate) < new Date() : false;
  const lowStock = daysOfCover !== null && daysOfCover < 3;
  const openMaintenance = maintenance.filter((m) => ['Scheduled','In Progress'].includes(m.status)).length;
  const riskAlerts = [
    lowStock ? 'LOW_STOCK' : null,
    overdueMaintenance ? 'MAINTENANCE_OVERDUE' : null,
    openMaintenance > 0 ? 'OPEN_MAINTENANCE' : null,
    tickets > 0 ? 'CUSTOMER_IMPACT' : null,
    plant.status === 'Offline' ? 'PLANT_OFFLINE' : null,
  ].filter(Boolean);
  return {
    plantId,
    name: plant.name,
    status: plant.status,
    capacityKg: capacity,
    uptimePct: num(plant.uptime),
    utilizationPct: round(utilizationPct, 1),
    outputTodayKg: num(plant.outputToday),
    targetDailyOutputKg: num(plant.targetDailyOutputKg),
    stock,
    profitability,
    daysOfCover: daysOfCover === null ? null : round(daysOfCover, 1),
    lastMaintenanceDate: plant.lastMaintenanceDate || null,
    nextMaintenanceDate: plant.nextMaintenanceDate || null,
    openMaintenance,
    recentMaintenance: maintenance,
    safetyChecks: safety,
    openCustomerIssues: tickets,
    riskAlerts,
    riskLevel: riskAlerts.includes('PLANT_OFFLINE') || riskAlerts.includes('LOW_STOCK') ? 'HIGH' : riskAlerts.length ? 'MEDIUM' : 'LOW',
  };
};

const getOverview = async (req, res, next) => {
  try {
    const plants = await Plant.find({}).sort({ name: 1 }).lean();
    const rows = await Promise.all(plants.map(getReliabilityForPlant));
    const metrics = {
      totalPlants: rows.length,
      operationalPlants: rows.filter((p) => p.status === 'Operational').length,
      plantsAtRisk: rows.filter((p) => p.riskLevel !== 'LOW').length,
      lowStockPlants: rows.filter((p) => p.riskAlerts.includes('LOW_STOCK')).length,
      overdueMaintenance: rows.filter((p) => p.riskAlerts.includes('MAINTENANCE_OVERDUE')).length,
      totalStockKg: round(rows.reduce((s, p) => s + num(p.stock.currentKg), 0)),
      revenue30d: round(rows.reduce((s, p) => s + num(p.profitability.revenue30d), 0)),
      grossProfit30d: round(rows.reduce((s, p) => s + num(p.profitability.grossProfit30d), 0)),
    };
    res.json({ metrics, rows });
  } catch (error) {
    logger.error('Plant reliability overview error:', error);
    next(new HttpError(500, 'Failed to load plant reliability overview.'));
  }
};

const getPlantReliability = async (req, res, next) => {
  try {
    const plant = await Plant.findOne({ $or: [{ id: req.params.plantId }, { _id: req.params.plantId }] }).lean();
    if (!plant) return next(new HttpError(404, 'Plant not found.'));
    res.json(await getReliabilityForPlant(plant));
  } catch (error) {
    logger.error('Plant reliability detail error:', error);
    next(new HttpError(500, 'Failed to load plant reliability detail.'));
  }
};

const getMaintenanceDashboard = async (req, res, next) => {
  try {
    const plantId = req.params.plantId;
    const [logs, costs] = await Promise.all([
      MaintenanceLog.find({ plantId }).sort({ startDate: -1 }).limit(100).lean(),
      MaintenanceLog.aggregate([{ $match: { plantId } }, { $group: { _id: '$status', count: { $sum: 1 }, cost: { $sum: '$cost' } } }]).catch(() => []),
    ]);
    res.json({ plantId, logs, statusSummary: costs });
  } catch (error) {
    logger.error('Maintenance dashboard error:', error);
    next(new HttpError(500, 'Failed to load maintenance dashboard.'));
  }
};

const getAssetRegister = async (req, res, next) => {
  try {
    const plantId = req.params.plantId;
    const rows = await Asset.find({ $or: [{ plantId }, { branchId: plantId }, { location: plantId }, { type: 'Plant' }] }).sort({ purchaseDate: -1 }).lean().catch(() => []);
    res.json({ plantId, rows });
  } catch (error) {
    logger.error('Asset register error:', error);
    next(new HttpError(500, 'Failed to load plant asset register.'));
  }
};

const createSafetyCheck = async (req, res, next) => {
  try {
    const plantId = req.params.plantId;
    const plant = await Plant.findOne({ id: plantId }).lean();
    if (!plant) return next(new HttpError(404, 'Plant not found.'));
    const doc = await PlantSafetyCheck.create({
      plantId,
      checkDate: req.body.checkDate || new Date(),
      checklistName: req.body.checklistName || 'Daily Safety Inspection',
      performedBy: req.body.performedBy || req.user?.email || req.user?.id || 'system',
      status: req.body.status || 'PASS',
      findings: req.body.findings || '',
      correctiveAction: req.body.correctiveAction || '',
      dueDate: req.body.dueDate || null,
    });
    res.status(201).json(doc);
  } catch (error) {
    logger.error('Create safety check error:', error);
    next(new HttpError(500, 'Failed to create safety check.'));
  }
};

module.exports = { getOverview, getPlantReliability, getMaintenanceDashboard, getAssetRegister, createSafetyCheck };
