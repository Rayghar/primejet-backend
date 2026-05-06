// src/api/v2/inventory/inventory.controller.js
const Asset = require('../../../models/asset.model');
const Loan = require('../../../models/loan.model');
const Cylinder = require('../../../models/cylinder.model');
const StockIn = require('../../../models/stockIn.model');
const Order = require('../../../models/order.model');
const DailySummary = require('../../../models/dailySummary.model');
const ExpenseTransaction = require('../../../models/expenseTransaction.model');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');
const mongoose = require('mongoose');
const StockMovement = require('../../../models/stockMovement.model');
const StockReconciliation = require('../../../models/stockReconciliation.model');
const { recordStockInMovement, recordReconciliation, listMovements, getSystemStockKg, getStockValue } = require('./services/stockLedger.service');
const { getWacCostPerKgAsOf } = require('../gl/services/wac.service');
const LpgProduct = require('../../../models/lpgProduct.model');
const BranchPrice = require('../../../models/branchPrice.model');
const BranchStockConfig = require('../../../models/branchStockConfig.model');
const OpeningBalance = require('../../../models/openingBalance.model');
const { lookupEffectivePrice, computeCogsReadiness } = require('./services/productPricing.service');
const { validateStockInBeforeLog, assertValidPlant } = require('../control/operationalValidation.service');
const { upsertJournal } = require('../gl/services/journalUpsert.service');
const { DEFAULT_ACCOUNTS } = require('../gl/services/coaMapping.service');
const { resolveBranchIdentity } = require('../utils/branchIdentity');

// -------------------------
// Helpers
// -------------------------
const hasVal = (v) => v !== undefined && v !== null && String(v).trim() !== '';
const splitBranchValues = (value) => {
  if (Array.isArray(value)) return value.flatMap(splitBranchValues);
  if (!hasVal(value)) return [];
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
};
const normalizeBranchKey = (value) => String(value || '').trim().toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
const branchKeyMatches = (left, right) => {
  const a = normalizeBranchKey(left);
  const b = normalizeBranchKey(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 4 && b.includes(a)) return true;
  if (b.length >= 4 && a.includes(b)) return true;
  return false;
};
const plantAliases = (plant = {}) => [plant._id ? String(plant._id) : null, plant.id, plant.name, plant.branchCode, plant.branchKey, plant.code, plant.key].filter(hasVal).map(String);

const toNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

// Supports older/newer API callers: branchId or serviceZoneId
const getBranchScope = (req) => {
  const branchId = req.query?.branchId || req.query?.serviceZoneId || req.body?.branchId || req.body?.serviceZoneId;
  return hasVal(branchId) ? String(branchId) : '';
};

const parseDateSafe = (v) => {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const findByAnyIdAndDelete = async (Model, id) => {
  if (!id) return null;

  // Try custom "id" first (your app pattern), then Mongo _id
  let deleted = await Model.findOneAndDelete({ id });
  if (deleted) return deleted;

  if (mongoose.Types.ObjectId.isValid(id)) {
    deleted = await Model.findByIdAndDelete(id);
    if (deleted) return deleted;
  }

  return null;
};

/**
 * Fetches all assets.
 * Optional filter: branchId/serviceZoneId (if asset model stores branchId)
 */
const getAssets = async (req, res, next) => {
  try {
    const branchId = getBranchScope(req);
    const filter = {};
    if (branchId) filter.branchId = branchId;

    const assets = await Asset.find(filter).sort({ createdAt: -1, _id: -1 });
    res.status(200).json(assets);
  } catch (error) {
    logger.error('Error fetching assets:', error);
    next(new HttpError(500, 'Failed to fetch assets.'));
  }
};

/**
 * Adds a new asset.
 */
const addAsset = async (req, res, next) => {
  try {
    const branchId = getBranchScope(req);

    const payload = {
      ...req.body,
      cost: toNum(req.body?.cost, 0),
    };

    // Make IDs explicit and consistent with frontend delete flow
    if (!payload.id) payload.id = new mongoose.Types.ObjectId().toString();
    if (branchId && !payload.branchId) payload.branchId = branchId;

    if (hasVal(payload.purchaseDate)) {
      const parsed = parseDateSafe(payload.purchaseDate);
      if (!parsed) throw new HttpError(400, 'Invalid purchaseDate.');
      payload.purchaseDate = parsed;
    }

    const newAsset = new Asset(payload);
    await newAsset.save();

    res.status(201).json(newAsset);
  } catch (error) {
    logger.error('Error adding asset:', error);
    if (error instanceof HttpError) return next(error);
    if (error.name === 'ValidationError') return next(new HttpError(400, error.message));
    next(new HttpError(500, 'Failed to add asset.'));
  }
};

/**
 * Deletes an asset by its ID.
 */
const deleteAsset = async (req, res, next) => {
  try {
    const { assetId } = req.params;
    const deleted = await findByAnyIdAndDelete(Asset, assetId);
    if (!deleted) throw new HttpError(404, 'Asset not found.');

    res.status(200).json({ message: 'Asset deleted successfully.' });
  } catch (error) {
    logger.error('Error deleting asset:', error);
    next(error instanceof HttpError ? error : new HttpError(500, 'Failed to delete asset.'));
  }
};

/**
 * Fetches all loans.
 * Optional filter: branchId/serviceZoneId (if loan model stores branchId)
 */
const getLoans = async (req, res, next) => {
  try {
    const branchId = getBranchScope(req);
    const filter = {};
    if (branchId) filter.branchId = branchId;

    const loans = await Loan.find(filter).sort({ createdAt: -1, _id: -1 });
    res.status(200).json(loans);
  } catch (error) {
    logger.error('Error fetching loans:', error);
    next(new HttpError(500, 'Failed to fetch loans.'));
  }
};

/**
 * Adds a new loan.
 */
const addLoan = async (req, res, next) => {
  try {
    const branchId = getBranchScope(req);

    const payload = {
      ...req.body,
      principal: toNum(req.body?.principal, 0),
      interestRate: toNum(req.body?.interestRate, 0),
      term: toNum(req.body?.term, 0),
    };

    if (!payload.id) payload.id = new mongoose.Types.ObjectId().toString();
    if (branchId && !payload.branchId) payload.branchId = branchId;

    const newLoan = new Loan(payload);
    await newLoan.save();

    res.status(201).json(newLoan);
  } catch (error) {
    logger.error('Error adding loan:', error);
    if (error.name === 'ValidationError') return next(new HttpError(400, error.message));
    next(new HttpError(500, 'Failed to add loan.'));
  }
};

/**
 * Deletes a loan by its ID.
 */
const deleteLoan = async (req, res, next) => {
  try {
    const { loanId } = req.params;
    const deleted = await findByAnyIdAndDelete(Loan, loanId);
    if (!deleted) throw new HttpError(404, 'Loan not found.');

    res.status(200).json({ message: 'Loan deleted successfully.' });
  } catch (error) {
    logger.error('Error deleting loan:', error);
    next(error instanceof HttpError ? error : new HttpError(500, 'Failed to delete loan.'));
  }
};

/**
 * Fetches all cylinders.
 * Optional filter: branchId/serviceZoneId (if cylinder model stores branchId)
 */
const getCylinders = async (req, res, next) => {
  try {
    const branchId = getBranchScope(req);
    const filter = {};
    if (branchId) filter.branchId = branchId;

    const cylinders = await Cylinder.find(filter).sort({ createdAt: -1, _id: -1 });
    res.status(200).json(cylinders);
  } catch (error) {
    logger.error('Error fetching cylinders:', error);
    next(new HttpError(500, 'Failed to fetch cylinders.'));
  }
};

/**
 * Adds a new cylinder.
 */
const addCylinder = async (req, res, next) => {
  try {
    const branchId = getBranchScope(req);

    const payload = {
      ...req.body,
      quantity: toNum(req.body?.quantity, 0),
    };

    if (!payload.id) payload.id = new mongoose.Types.ObjectId().toString();
    if (branchId && !payload.branchId) payload.branchId = branchId;

    const newCylinder = new Cylinder(payload);
    await newCylinder.save();

    res.status(201).json(newCylinder);
  } catch (error) {
    logger.error('Error adding cylinder:', error);
    if (error.name === 'ValidationError') return next(new HttpError(400, error.message));
    next(new HttpError(500, 'Failed to add cylinder.'));
  }
};

/**
 * Deletes a cylinder by its ID.
 */
const deleteCylinder = async (req, res, next) => {
  try {
    const { cylinderId } = req.params;
    const deleted = await findByAnyIdAndDelete(Cylinder, cylinderId);
    if (!deleted) throw new HttpError(404, 'Cylinder batch not found.');

    res.status(200).json({ message: 'Cylinder batch deleted successfully.' });
  } catch (error) {
    logger.error('Error deleting cylinder:', error);
    next(error instanceof HttpError ? error : new HttpError(500, 'Failed to delete cylinder.'));
  }
};

/**
 * Logs a new stock-in (bulk LPG purchase) transaction.
 */
const addStockIn = async (req, res, next) => {
  try {
    const {
      quantityKg,
      supplier,
      purchaseDate,
      costPerKg,
      targetSalePricePerKg,
    } = req.body;

    const branchId = getBranchScope(req);
    const loggedBy = { uid: req.user?.id, email: req.user?.email };

    if (!branchId) {
      throw new HttpError(400, 'branchId (or serviceZoneId) is required for stock-in.');
    }

    await validateStockInBeforeLog({ branchId, quantityKg, costPerKg, supplier, purchaseDate, reference: req.body?.reference || req.body?.supplierInvoiceRef });

    const qty = toNum(quantityKg, NaN);
    const cost = toNum(costPerKg, NaN);
    const targetPrice = toNum(targetSalePricePerKg, NaN);
    const purchaseDt = parseDateSafe(purchaseDate);

    if (!Number.isFinite(qty) || qty <= 0) throw new HttpError(400, 'quantityKg must be a positive number.');
    if (!Number.isFinite(cost) || cost < 0) throw new HttpError(400, 'costPerKg must be a valid number.');
    if (!Number.isFinite(targetPrice) || targetPrice < 0) throw new HttpError(400, 'targetSalePricePerKg must be a valid number.');
    if (!purchaseDt) throw new HttpError(400, 'purchaseDate is invalid.');

    const newStockIn = new StockIn({
      id: new mongoose.Types.ObjectId().toString(),
      branchId,
      stockType: 'PURCHASE',
      quantityKg: qty,
      supplier,
      purchaseDate: purchaseDt,
      costPerKg: cost,
      targetSalePricePerKg: targetPrice,
      remainingKg: qty,
      amountPaid: toNum(req.body?.amountPaid ?? req.body?.paidAmount, 0),
      paidAmount: toNum(req.body?.paidAmount ?? req.body?.amountPaid, 0),
      isPaid: Boolean(req.body?.isPaid),
      paymentStatus: req.body?.paymentStatus || null,
      paymentMethod: req.body?.paymentMethod || null,
      loggedBy,
    });

    await newStockIn.save();
    await recordStockInMovement(newStockIn, req.user?.id || 'system');

    logger.info(`New stock-in logged: ${qty}kg from ${supplier} (branch ${branchId}) by ${req.user?.email || 'system'}`);
    res.status(201).json({ message: 'Stock-in logged successfully.', stockIn: newStockIn });
  } catch (error) {
    logger.error('Error adding stock-in:', error);
    if (error.name === 'ValidationError') {
      return next(new HttpError(400, error.message));
    }
    next(error instanceof HttpError ? error : new HttpError(500, 'Failed to log stock-in.'));
  }
};

/**
 * ✅ Provides a comprehensive summary of inventory data.
 * Source of truth = StockIn.remainingKg
 */
const getInventorySummary = async (req, res, next) => {
  try {
    const branchId = getBranchScope(req);

    const stockMatch = {};
    if (branchId) stockMatch.branchId = branchId;

    // Total stocked (for reporting only)
    const totalStockedResult = await StockIn.aggregate([
      { $match: stockMatch },
      { $group: { _id: null, total: { $sum: '$quantityKg' } } },
    ]);
    const totalStockedKg = toNum(totalStockedResult[0]?.total, 0);

    // ✅ Source of truth: remaining stock
    const remainingResult = await StockIn.aggregate([
      { $match: stockMatch },
      { $group: { _id: null, remaining: { $sum: '$remainingKg' } } },
    ]);
    const currentBulkLpgKg = toNum(remainingResult[0]?.remaining, 0);

    // Derived sold (informational only)
    const totalSoldKg = Math.max(0, totalStockedKg - currentBulkLpgKg);

    // Capacity approximation for dashboards (lets UI show stock % if desired)
    const totalCapacity = totalStockedKg;

    // Cylinders may or may not be branch-scoped in your schema
    const cylinderMatch = {};
    if (branchId) cylinderMatch.branchId = branchId;

    let totalCylinders = 0;
    try {
      const totalCylindersResult = await Cylinder.aggregate([
        { $match: cylinderMatch },
        { $group: { _id: null, total: { $sum: '$quantity' } } },
      ]);
      totalCylinders = toNum(totalCylindersResult[0]?.total, 0);
    } catch (e) {
      // If Cylinder schema has no branchId but branch filter supplied, fallback gracefully
      if (branchId) {
        const totalCylindersResult = await Cylinder.aggregate([
          { $group: { _id: null, total: { $sum: '$quantity' } } },
        ]);
        totalCylinders = toNum(totalCylindersResult[0]?.total, 0);
      } else {
        throw e;
      }
    }

    const lowStockThresholdKg = 1000;
    const lowStockAlert = currentBulkLpgKg < lowStockThresholdKg;
    const stockUtilizationPct = totalCapacity > 0 ? (currentBulkLpgKg / totalCapacity) * 100 : 0;

    res.status(200).json({
      branchId: branchId || null,
      currentBulkLpgKg,
      currentStock: currentBulkLpgKg, // alias for frontend compatibility
      totalSoldKg,
      totalStockedKg,
      totalCapacity,
      totalCylinders,
      lowStockAlert,
      lowStockThresholdKg,
      stockUtilizationPct: Number(stockUtilizationPct.toFixed(2)),
    });
  } catch (error) {
    logger.error('Error fetching inventory summary:', error);
    next(new HttpError(500, 'Failed to fetch inventory summary.'));
  }
};

/**
 * ✅ Fetches LPG stock-in history with profitability.
 * Uses batch consumption = quantityKg - remainingKg
 */
const getLpgStockInHistory = async (req, res, next) => {
  try {
    const branchId = getBranchScope(req);

    const stockMatch = {};
    if (branchId) stockMatch.branchId = branchId;

    const stockIns = await StockIn.find(stockMatch).sort({ purchaseDate: -1, _id: -1 }).lean();

    // Fetch relevant sales inputs once (branch-aware where possible)
    const orderFilter = {
      status: 'Delivered',
    };
    if (branchId) orderFilter.branchId = branchId;

    const summaryFilter = {
      status: 'approved',
    };
    if (branchId) summaryFilter.branchId = branchId;

    const [deliveredOrders, approvedSummaries] = await Promise.all([
      Order.find(orderFilter).select('grandTotal items orderDate createdAt channel branchId').lean(),
      DailySummary.find(summaryFilter).select('date sales pricePerKg branchId').lean(),
    ]);

    const historyWithProfitability = stockIns.map((batch) => {
      const quantityKg = toNum(batch.quantityKg, 0);
      const remainingKg = toNum(batch.remainingKg, 0);
      const costPerKg = toNum(batch.costPerKg, 0);
      const targetSalePricePerKg = toNum(batch.targetSalePricePerKg, 0);
      const batchPurchaseDate = parseDateSafe(batch.purchaseDate) || new Date(0);

      const batchSoldKg = Math.max(0, quantityKg - remainingKg);

      const expectedRevenue = quantityKg * targetSalePricePerKg;
      const totalCost = quantityKg * costPerKg;

      // Filter sales after batch purchaseDate
      const relevantOrders = deliveredOrders.filter((o) => {
        const d = parseDateSafe(o.orderDate || o.createdAt);
        if (!d) return false;
        // If channel exists, keep delivery-only (exclude POS DailySummary overlap)
        if (String(o.channel || '').toUpperCase() === 'POS') return false;
        return d >= batchPurchaseDate;
      });

      const relevantSummaries = approvedSummaries.filter((s) => {
        const d = parseDateSafe(s.date);
        if (!d) return false;
        return d >= batchPurchaseDate;
      });

      // Compute average realized prices (simple, non-double-counting)
      const deliveryKg = relevantOrders.reduce((sum, o) => {
        const itemsKg = Array.isArray(o.items)
          ? o.items.reduce((s, it) => s + toNum(it?.quantity, 0), 0)
          : 0;
        return sum + itemsKg;
      }, 0);
      const deliveryRevenue = relevantOrders.reduce((sum, o) => sum + toNum(o?.grandTotal, 0), 0);
      const deliveryAvgPrice = deliveryKg > 0 ? deliveryRevenue / deliveryKg : 0;

      const posKg = relevantSummaries.reduce((sum, s) => sum + toNum(s?.sales?.totalKgSold, 0), 0);
      const posRevenue = relevantSummaries.reduce((sum, s) => sum + toNum(s?.sales?.totalRevenue, 0), 0);
      const posAvgPrice = posKg > 0 ? posRevenue / posKg : 0;

      // Estimate revenue for this batch sold kg using blended avg price
      let observedAvgPrice = 0;
      if (deliveryAvgPrice > 0 && posAvgPrice > 0) observedAvgPrice = (deliveryAvgPrice + posAvgPrice) / 2;
      else if (deliveryAvgPrice > 0) observedAvgPrice = deliveryAvgPrice;
      else if (posAvgPrice > 0) observedAvgPrice = posAvgPrice;
      else observedAvgPrice = targetSalePricePerKg || 0;

      const estimatedActualRevenue = batchSoldKg * observedAvgPrice;

      const profitLoss = estimatedActualRevenue - totalCost;
      const profitMargin = totalCost > 0 ? (profitLoss / totalCost) * 100 : 0;
      const salesProgress = quantityKg > 0 ? (batchSoldKg / quantityKg) * 100 : 0;

      return {
        ...batch,
        batchSoldKg,
        expectedRevenue,
        totalCost,
        estimatedActualRevenue,
        profitLoss,
        profitMargin: Number(profitMargin.toFixed(2)),
        salesProgress: Number(salesProgress.toFixed(2)),
        observedAvgPricePerKg: Number(toNum(observedAvgPrice, 0).toFixed(2)),
      };
    });

    res.status(200).json(historyWithProfitability);
  } catch (error) {
    logger.error('Error fetching LPG stock-in history:', error);
    next(new HttpError(500, 'Failed to retrieve LPG stock-in history.'));
  }
};


/** Wave 3: Load opening LPG stock. Creates a StockIn with stockType=OPENING_STOCK. */
const loadOpeningStock = async (req, res, next) => {
  try {
    const branchId = getBranchScope(req);
    const quantityKg = toNum(req.body?.quantityKg, NaN);
    const costPerKg = toNum(req.body?.costPerKg, NaN);
    const targetSalePricePerKg = toNum(req.body?.targetSalePricePerKg ?? req.body?.salePricePerKg ?? costPerKg, NaN);
    const businessDate = parseDateSafe(req.body?.businessDate || req.body?.date || req.body?.purchaseDate || new Date());
    if (!branchId) throw new HttpError(400, 'branchId is required.');
    await validateStockInBeforeLog({ branchId, quantityKg, costPerKg, supplier: 'Opening stock', purchaseDate: businessDate });
    if (!Number.isFinite(quantityKg) || quantityKg <= 0) throw new HttpError(400, 'quantityKg must be positive.');
    if (!Number.isFinite(costPerKg) || costPerKg <= 0) throw new HttpError(400, 'costPerKg must be positive.');
    if (!businessDate) throw new HttpError(400, 'businessDate is invalid.');

    const exists = await StockIn.findOne({ branchId: String(branchId), stockType: 'OPENING_STOCK' }).lean();
    if (exists && !req.body?.allowAdditionalOpeningStock) {
      throw new HttpError(409, 'Opening stock already exists for this branch. Use stock-in or set allowAdditionalOpeningStock=true if this is intentional.');
    }

    const stockIn = await StockIn.create({
      id: new mongoose.Types.ObjectId().toString(),
      branchId: String(branchId),
      stockType: 'OPENING_STOCK',
      quantityKg,
      remainingKg: quantityKg,
      supplier: req.body?.supplier || 'Opening Stock',
      purchaseDate: businessDate,
      costPerKg,
      targetSalePricePerKg: Number.isFinite(targetSalePricePerKg) && targetSalePricePerKg > 0 ? targetSalePricePerKg : costPerKg,
      amountPaid: 0,
      paidAmount: 0,
      isPaid: false,
      paymentStatus: 'opening',
      loggedBy: { uid: req.user?.id || 'system', email: req.user?.email || 'system@local' },
    });
    await recordStockInMovement(stockIn, req.user?.id || 'system');
    res.status(201).json({ message: 'Opening stock loaded successfully.', stockIn });
  } catch (error) {
    logger.error('Error loading opening stock:', error);
    next(error instanceof HttpError ? error : new HttpError(error.status || 500, error.message || 'Failed to load opening stock.'));
  }
};

const getStockMovements = async (req, res, next) => {
  try {
    const branchId = getBranchScope(req);
    const items = await listMovements({ branchId, startDate: req.query?.startDate, endDate: req.query?.endDate, movementType: req.query?.movementType, limit: req.query?.limit || 100 });
    res.status(200).json({ ok: true, items });
  } catch (error) {
    logger.error('Error fetching stock movements:', error);
    next(new HttpError(500, 'Failed to fetch stock movements.'));
  }
};

const reconcileStock = async (req, res, next) => {
  try {
    const branchId = getBranchScope(req);
    const result = await recordReconciliation({
      branchId,
      businessDate: req.body?.businessDate || req.body?.date || new Date(),
      physicalQtyKg: req.body?.physicalQtyKg,
      reason: req.body?.reason,
      postVariance: Boolean(req.body?.postVariance),
      createdBy: req.user?.id || 'system',
    });
    res.status(201).json({ message: 'Stock reconciliation recorded successfully.', ...result });
  } catch (error) {
    logger.error('Error reconciling stock:', error);
    next(new HttpError(error.status || 400, error.message || 'Failed to reconcile stock.'));
  }
};

const getReconciliations = async (req, res, next) => {
  try {
    const branchId = getBranchScope(req);
    const q = {};
    if (branchId) q.branchId = String(branchId);
    if (req.query?.startDate || req.query?.endDate) q.businessDate = {};
    if (req.query?.startDate) q.businessDate.$gte = parseDateSafe(req.query.startDate);
    if (req.query?.endDate) q.businessDate.$lte = parseDateSafe(req.query.endDate);
    const items = await StockReconciliation.find(q).sort({ businessDate: -1, createdAt: -1 }).limit(100).lean();
    res.status(200).json({ ok: true, items });
  } catch (error) {
    logger.error('Error fetching reconciliations:', error);
    next(new HttpError(500, 'Failed to fetch reconciliations.'));
  }
};

const buildBranchFilter = (branchId, fields = ['branchId']) => {
  if (!branchId) return {};
  const s = String(branchId);
  const ors = [];
  for (const field of fields) ors.push({ [field]: s });
  if (mongoose.Types.ObjectId.isValid(s)) {
    const oid = new mongoose.Types.ObjectId(s);
    for (const field of fields) ors.push({ [field]: oid });
  }
  return { $or: ors };
};

const buildBranchModelFilters = async (branchId) => {
  const branchValues = splitBranchValues(branchId);
  if (!branchValues.length) return { daily: {}, stringBranch: {}, order: {}, gl: {}, aliases: [], objectIds: [] };

  const identities = await Promise.all(branchValues.map((value) => resolveBranchIdentity(value).catch(() => null)));
  const aliases = [...new Set([
    ...branchValues.map(String),
    ...identities.flatMap((identity) => identity?.aliases || []),
  ].filter(hasVal).map(String))];
  const objectIds = [...new Map(identities
    .flatMap((identity) => identity?.objectIds || [])
    .map((oid) => [String(oid), oid])).values()];

  const daily = objectIds.length ? { branchId: { $in: objectIds } } : { _id: { $exists: false } };
  const stringBranch = aliases.length ? { branchId: { $in: aliases } } : { _id: { $exists: false } };
  const orderOr = [];
  if (objectIds.length) orderOr.push({ branchId: { $in: objectIds } });
  if (aliases.length) orderOr.push({ serviceZoneId: { $in: aliases } }, { zoneId: { $in: aliases } }, { plantId: { $in: aliases } }, { branchKey: { $in: aliases } });
  return { daily, stringBranch, order: orderOr.length ? { $or: orderOr } : { _id: { $exists: false } }, aliases, objectIds };
};

const compactQuery = (...parts) => {
  const and = parts.filter((p) => p && Object.keys(p).length);
  if (and.length === 0) return {};
  if (and.length === 1) return and[0];
  return { $and: and };
};

const getOrderKgSold = (order) => {
  const direct = toNum(order?.kgSold ?? order?.totalKgSold ?? order?.lpgKgSold ?? order?.lpgKg ?? order?.totalKg, NaN);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const meta = order?.metadata || {};
  const metaKg = toNum(typeof meta.get === 'function' ? meta.get('kgSold') : (meta.kgSold ?? meta.totalKgSold ?? meta.lpgKg), NaN);
  if (Number.isFinite(metaKg) && metaKg > 0) return metaKg;
  if (Array.isArray(order?.items)) {
    return order.items.reduce((sum, item) => {
      const kg = toNum(item?.kg ?? item?.quantityKg ?? item?.lpgKg ?? item?.weightKg, NaN);
      if (Number.isFinite(kg) && kg > 0) return sum + kg;
      return sum + toNum(item?.quantity, 0);
    }, 0);
  }
  return 0;
};

const getReportRange = (req) => {
  const start = parseDateSafe(req.query?.startDate || new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const end = parseDateSafe(req.query?.endDate || new Date());
  if (start) start.setHours(0, 0, 0, 0);
  if (end) end.setHours(23, 59, 59, 999);
  return { start, end };
};

const getGrossProfitReport = async (req, res, next) => {
  try {
    const branchId = getBranchScope(req);
    const { start, end } = getReportRange(req);
    if (!start || !end) throw new HttpError(400, 'Invalid startDate/endDate.');

    const filters = await buildBranchModelFilters(branchId);

    const [summaries, orders, depletionMovements, expenses] = await Promise.all([
      DailySummary.find(compactQuery(branchId ? filters.daily : {}, { status: { $in: ['approved', 'posted', 'closed'] }, date: { $gte: start, $lte: end } })).lean(),
      Order.find(compactQuery(branchId ? filters.order : {}, {
        status: 'Delivered',
        $and: [
          { $or: [{ channel: { $exists: false } }, { channel: 'DELIVERY' }] },
          { $or: [{ orderDate: { $gte: start, $lte: end } }, { orderDate: { $exists: false }, createdAt: { $gte: start, $lte: end } }] },
        ],
      })).lean(),
      StockMovement.find(compactQuery(branchId ? filters.stringBranch : {}, { movementType: { $in: ['SALE_DEPLETION', 'ORDER_DEPLETION'] }, movementDate: { $gte: start, $lte: end } })).lean(),
      ExpenseTransaction.find(compactQuery(branchId ? filters.stringBranch : {}, { status: { $in: ['approved', 'Approved', 'APPROVED'] }, date: { $gte: start, $lte: end } })).lean(),
    ]);

    const posRevenue = summaries.reduce((sum, d) => sum + toNum(d?.sales?.totalRevenue, 0), 0);
    const posKgSold = summaries.reduce((sum, d) => sum + toNum(d?.sales?.totalKgSold, 0), 0);
    const deliveryRevenue = orders.reduce((sum, o) => sum + toNum(o?.grandTotal ?? o?.totalAmount, 0), 0);
    const deliveryKgSold = orders.reduce((sum, o) => sum + getOrderKgSold(o), 0);
    const movementCogs = depletionMovements.reduce((sum, m) => sum + toNum(m?.totalCost, 0), 0);
    const kgSold = posKgSold + deliveryKgSold;
    const revenue = posRevenue + deliveryRevenue;
    const wacKey = filters.aliases?.[0] || branchId || null;
    const wac = await getWacCostPerKgAsOf(wacKey, end);
    const fallbackCogs = kgSold * toNum(wac.wac, 0);
    const cogs = movementCogs > 0 ? movementCogs : fallbackCogs;
    const grossProfit = revenue - cogs;
    const opex = expenses.reduce((sum, e) => sum + toNum(e.amount, 0), 0);

    res.status(200).json({
      ok: true,
      branchId: branchId || null,
      period: { start, end },
      revenue,
      posRevenue,
      deliveryRevenue,
      kgSold,
      posKgSold,
      deliveryKgSold,
      wacCostPerKg: toNum(wac.wac, 0),
      cogs,
      cogsSource: movementCogs > 0 ? 'STOCK_MOVEMENT_LEDGER' : 'WAC_FALLBACK',
      grossProfit,
      grossMarginPct: revenue > 0 ? (grossProfit / revenue) * 100 : 0,
      opex,
      netProfit: grossProfit - opex,
    });
  } catch (error) {
    logger.error('Error generating gross profit report:', error);
    next(error instanceof HttpError ? error : new HttpError(500, error.message || 'Failed to generate gross profit report.'));
  }
};

const getBranchProfitabilityReport = async (req, res, next) => {
  try {
    const { start, end } = getReportRange(req);
    if (!start || !end) throw new HttpError(400, 'Invalid startDate/endDate.');
    const branchScope = getBranchScope(req);
    const branchValues = splitBranchValues(branchScope);
    const Plant = require('../../../models/plant.model');
    let plants = await Plant.find({}).select('_id id name branchCode branchKey code key').lean();
    if (branchValues.length) {
      plants = plants.filter((plant) => {
        const aliases = plantAliases(plant);
        return branchValues.some((value) => aliases.some((alias) => branchKeyMatches(alias, value)));
      });
    }
    const rows = [];

    for (const p of plants) {
      const aliases = [String(p._id), p.id ? String(p.id) : null, p.name ? String(p.name) : null].filter(Boolean);
      const objectId = new mongoose.Types.ObjectId(String(p._id));
      const dailyFilter = { branchId: objectId };
      const stringBranchFilter = { branchId: { $in: aliases } };
      const orderFilter = {
        $or: [
          { branchId: objectId },
          { serviceZoneId: { $in: aliases } },
          { zoneId: { $in: aliases } },
          { plantId: { $in: aliases } },
          { branchKey: { $in: aliases } },
        ],
      };

      const [summaries, orders, expenses, depletionMovements, varianceMovements] = await Promise.all([
        DailySummary.find(compactQuery(dailyFilter, { status: { $in: ['approved', 'posted', 'closed'] }, date: { $gte: start, $lte: end } })).lean(),
        Order.find(compactQuery(orderFilter, {
          status: 'Delivered',
          $and: [
            { $or: [{ channel: { $exists: false } }, { channel: 'DELIVERY' }] },
            { $or: [{ orderDate: { $gte: start, $lte: end } }, { orderDate: { $exists: false }, createdAt: { $gte: start, $lte: end } }] },
          ],
        })).lean(),
        ExpenseTransaction.find(compactQuery(stringBranchFilter, { status: { $in: ['approved', 'Approved', 'APPROVED'] }, date: { $gte: start, $lte: end } })).lean(),
        StockMovement.find(compactQuery(stringBranchFilter, { movementType: { $in: ['SALE_DEPLETION', 'ORDER_DEPLETION'] }, movementDate: { $gte: start, $lte: end } })).lean(),
        StockMovement.find(compactQuery(stringBranchFilter, { movementType: 'RECONCILIATION_VARIANCE', movementDate: { $gte: start, $lte: end } })).lean(),
      ]);

      const posRevenue = summaries.reduce((sum, d) => sum + toNum(d?.sales?.totalRevenue, 0), 0);
      const posKgSold = summaries.reduce((sum, d) => sum + toNum(d?.sales?.totalKgSold, 0), 0);
      const deliveryRevenue = orders.reduce((sum, o) => sum + toNum(o?.grandTotal ?? o?.totalAmount, 0), 0);
      const deliveryKgSold = orders.reduce((sum, o) => sum + getOrderKgSold(o), 0);
      const revenue = posRevenue + deliveryRevenue;
      const kgSold = posKgSold + deliveryKgSold;
      const movementCogs = depletionMovements.reduce((sum, m) => sum + toNum(m?.totalCost, 0), 0);
      const wac = await getWacCostPerKgAsOf(p.id || String(p._id), end);
      const cogs = movementCogs > 0 ? movementCogs : kgSold * toNum(wac.wac, 0);
      const opex = expenses.reduce((sum, e) => sum + toNum(e.amount, 0), 0);
      const stockVariance = varianceMovements.reduce((sum, m) => sum + (String(m.direction).toUpperCase() === 'OUT' ? -1 : 1) * toNum(m.totalCost, 0), 0);
      const grossProfit = revenue - cogs;

      rows.push({
        branchId: String(p._id),
        branchCode: p.id || null,
        branchName: p.name || p.id || String(p._id),
        revenue,
        posRevenue,
        deliveryRevenue,
        kgSold,
        posKgSold,
        deliveryKgSold,
        wacCostPerKg: toNum(wac.wac, 0),
        cogs,
        cogsSource: movementCogs > 0 ? 'STOCK_MOVEMENT_LEDGER' : 'WAC_FALLBACK',
        grossProfit,
        opex,
        stockVariance,
        netProfit: grossProfit - opex,
        grossMarginPct: revenue > 0 ? (grossProfit / revenue) * 100 : 0,
      });
    }

    res.status(200).json({ ok: true, period: { start, end }, branch: { branchId: branchScope || null, restricted: Boolean(req.branchScopeFilter?.restricted) }, rows });
  } catch (error) {
    logger.error('Error generating branch profitability:', error);
    next(error instanceof HttpError ? error : new HttpError(500, error.message || 'Failed to generate branch profitability report.'));
  }
};

const listProducts = async (req, res, next) => {
  try {
    const q = {};
    if (req.query?.activeOnly !== 'false') q.isActive = true;
    if (req.query?.productType) q.productType = String(req.query.productType);
    const items = await LpgProduct.find(q).sort({ isLpg: -1, name: 1 }).lean();
    res.status(200).json({ ok: true, items });
  } catch (error) {
    logger.error('Error listing products:', error);
    next(new HttpError(500, 'Failed to list products.'));
  }
};

const upsertProduct = async (req, res, next) => {
  try {
    const sku = String(req.body?.sku || '').trim().toUpperCase();
    if (!sku) throw new HttpError(400, 'sku is required.');
    if (!req.body?.name) throw new HttpError(400, 'name is required.');
    const payload = {
      sku,
      name: String(req.body.name).trim(),
      productType: req.body?.productType || 'BULK_LPG',
      unitOfMeasure: req.body?.unitOfMeasure || 'KG',
      defaultKg: toNum(req.body?.defaultKg, 1),
      defaultSellingPrice: toNum(req.body?.defaultSellingPrice, 0),
      costingMethod: req.body?.costingMethod || 'WAC',
      isLpg: req.body?.isLpg !== false,
      isActive: req.body?.isActive !== false,
      description: req.body?.description || null,
      updatedBy: req.user?.id || 'system',
    };
    const product = await LpgProduct.findOneAndUpdate(
      { sku },
      { $set: payload, $setOnInsert: { createdBy: req.user?.id || 'system' } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.status(200).json({ ok: true, product });
  } catch (error) {
    logger.error('Error saving product:', error);
    next(error instanceof HttpError ? error : new HttpError(500, 'Failed to save product.'));
  }
};

const listBranchPrices = async (req, res, next) => {
  try {
    const branchId = getBranchScope(req);
    const q = {};
    if (branchId) q.branchId = String(branchId);
    if (req.query?.productId) q.productId = String(req.query.productId);
    const items = await BranchPrice.find(q).sort({ branchId: 1, effectiveStartDate: -1 }).lean();
    res.status(200).json({ ok: true, items });
  } catch (error) {
    logger.error('Error listing branch prices:', error);
    next(new HttpError(500, 'Failed to list branch prices.'));
  }
};

const upsertBranchPrice = async (req, res, next) => {
  try {
    const branchId = getBranchScope(req);
    if (!branchId) throw new HttpError(400, 'branchId is required.');
    const productId = String(req.body?.productId || req.body?.productSku || 'BULK-LPG-KG').trim();
    const lookup = await lookupEffectivePrice({ branchId, productId, businessDate: req.body?.effectiveStartDate || new Date() }).catch(() => null);
    const realProductId = String(lookup?.productId || productId);
    const pricePerKg = toNum(req.body?.pricePerKg, NaN);
    if (!Number.isFinite(pricePerKg) || pricePerKg <= 0) throw new HttpError(400, 'pricePerKg must be greater than zero.');
    const effectiveStartDate = parseDateSafe(req.body?.effectiveStartDate || new Date());
    const effectiveEndDate = req.body?.effectiveEndDate ? parseDateSafe(req.body.effectiveEndDate) : null;
    if (!effectiveStartDate) throw new HttpError(400, 'effectiveStartDate is invalid.');
    const row = await BranchPrice.create({
      branchId: String(branchId),
      productId: realProductId,
      productSku: lookup?.productSku || req.body?.productSku || null,
      pricePerKg,
      fixedPrice: toNum(req.body?.fixedPrice, 0),
      effectiveStartDate,
      effectiveEndDate,
      status: req.body?.status || 'ACTIVE',
      approvalStatus: req.body?.approvalStatus || 'NOT_REQUIRED',
      createdBy: req.user?.id || 'system',
      notes: req.body?.notes || null,
    });
    res.status(201).json({ ok: true, price: row });
  } catch (error) {
    logger.error('Error saving branch price:', error);
    next(error instanceof HttpError ? error : new HttpError(500, 'Failed to save branch price.'));
  }
};

const getEffectivePrice = async (req, res, next) => {
  try {
    const branchId = getBranchScope(req);
    if (!branchId) throw new HttpError(400, 'branchId is required.');
    const result = await lookupEffectivePrice({ branchId, productId: req.query?.productId || req.query?.productSku, productSku: req.query?.productSku, businessDate: req.query?.businessDate || req.query?.date || new Date() });
    res.status(200).json({ ok: true, ...result });
  } catch (error) {
    logger.error('Error looking up price:', error);
    next(error instanceof HttpError ? error : new HttpError(500, 'Failed to lookup price.'));
  }
};

const getBranchStockConfig = async (req, res, next) => {
  try {
    const branchId = getBranchScope(req);
    const q = branchId ? { branchId: String(branchId) } : {};
    const items = await BranchStockConfig.find(q).sort({ branchId: 1 }).lean();
    res.status(200).json({ ok: true, items });
  } catch (error) {
    logger.error('Error loading branch stock config:', error);
    next(new HttpError(500, 'Failed to load branch stock config.'));
  }
};

const saveBranchStockConfig = async (req, res, next) => {
  try {
    const branchId = getBranchScope(req);
    if (!branchId) throw new HttpError(400, 'branchId is required.');
    await assertValidPlant(branchId, { requireOperational: false });
    const payload = {
      branchId: String(branchId),
      stockLocationId: String(req.body?.stockLocationId || branchId),
      stockLocationName: req.body?.stockLocationName || req.body?.branchName || null,
      serviceZoneIds: Array.isArray(req.body?.serviceZoneIds) ? req.body.serviceZoneIds.map(String) : [],
      defaultProductId: req.body?.defaultProductId || null,
      defaultProductSku: req.body?.defaultProductSku || null,
      isActive: req.body?.isActive !== false,
      updatedBy: req.user?.id || 'system',
    };
    const item = await BranchStockConfig.findOneAndUpdate({ branchId: String(branchId) }, { $set: payload, $setOnInsert: { createdBy: req.user?.id || 'system' } }, { upsert: true, new: true, setDefaultsOnInsert: true });
    res.status(200).json({ ok: true, config: item });
  } catch (error) {
    logger.error('Error saving branch stock config:', error);
    next(error instanceof HttpError ? error : new HttpError(500, 'Failed to save branch stock config.'));
  }
};

const postOpeningBalances = async (req, res, next) => {
  try {
    const branchId = getBranchScope(req);
    const businessDate = parseDateSafe(req.body?.businessDate || req.body?.date || new Date());
    if (!businessDate) throw new HttpError(400, 'businessDate is invalid.');
    const vals = {
      cashOnHand: toNum(req.body?.cashOnHand, 0),
      bankTransfers: toNum(req.body?.bankTransfers, 0),
      bankPOS: toNum(req.body?.bankPOS, 0),
      inventoryValue: toNum(req.body?.inventoryValue, 0),
      accountsReceivable: toNum(req.body?.accountsReceivable, 0),
      accountsPayable: toNum(req.body?.accountsPayable, 0),
    };
    const debitTotal = vals.cashOnHand + vals.bankTransfers + vals.bankPOS + vals.inventoryValue + vals.accountsReceivable;
    const creditTotal = vals.accountsPayable;
    const openingEquity = Math.max(0, debitTotal - creditTotal);
    const ob = await OpeningBalance.findOneAndUpdate(
      { branchId: branchId ? String(branchId) : null, businessDate },
      { $set: { ...vals, openingEquity, notes: req.body?.notes || null, createdBy: req.user?.id || 'system' } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    const lines = [];
    if (vals.cashOnHand > 0) lines.push({ accountCode: DEFAULT_ACCOUNTS.CASH_ON_HAND, debit: vals.cashOnHand, narration: 'Opening cash balance' });
    if (vals.bankTransfers > 0) lines.push({ accountCode: DEFAULT_ACCOUNTS.BANK_TRANSFERS, debit: vals.bankTransfers, narration: 'Opening transfer bank balance' });
    if (vals.bankPOS > 0) lines.push({ accountCode: DEFAULT_ACCOUNTS.BANK_POS, debit: vals.bankPOS, narration: 'Opening POS settlement balance' });
    if (vals.inventoryValue > 0) lines.push({ accountCode: DEFAULT_ACCOUNTS.INVENTORY_LPG, debit: vals.inventoryValue, narration: 'Opening inventory value' });
    if (vals.accountsReceivable > 0) lines.push({ accountCode: DEFAULT_ACCOUNTS.ACCOUNTS_RECEIVABLE, debit: vals.accountsReceivable, narration: 'Opening receivables' });
    if (vals.accountsPayable > 0) lines.push({ accountCode: DEFAULT_ACCOUNTS.ACCOUNTS_PAYABLE, credit: vals.accountsPayable, narration: 'Opening payables' });
    if (openingEquity > 0) lines.push({ accountCode: DEFAULT_ACCOUNTS.OPENING_BALANCE_EQUITY, credit: openingEquity, narration: 'Opening balance equity' });
    if (lines.length) {
      const jr = await upsertJournal({ date: businessDate, branchKey: branchId || null, sourceType: 'MANUAL', sourceId: `OPENING_BALANCE:${ob.id}`, entryType: 'OPENING_BALANCE', narration: 'Opening balance wizard posting', lines, meta: { openingBalanceId: ob.id } });
      ob.posting = { status: 'POSTED', glEntryIds: jr.glEntryIds, postedAt: new Date(), errorMessage: null };
      await ob.save();
    }
    res.status(201).json({ ok: true, openingBalance: ob });
  } catch (error) {
    logger.error('Error posting opening balances:', error);
    next(error instanceof HttpError ? error : new HttpError(error.status || 500, error.message || 'Failed to post opening balances.'));
  }
};

const getCogsReadiness = async (req, res, next) => {
  try {
    const branchId = getBranchScope(req);
    const result = await computeCogsReadiness({ branchId });
    res.status(200).json({ ok: true, branchId: branchId || null, ...result });
  } catch (error) {
    logger.error('Error loading COGS readiness:', error);
    next(new HttpError(500, 'Failed to load COGS readiness.'));
  }
};

const activateCogs = async (req, res, next) => {
  try {
    const branchId = getBranchScope(req);
    if (!branchId) throw new HttpError(400, 'branchId is required.');
    const readiness = await computeCogsReadiness({ branchId });
    if (!readiness.ready && !req.body?.force) throw new HttpError(400, 'COGS is not ready: ' + readiness.controls.filter((c) => !c.passed).map((c) => c.message).join(' | '));
    const cfg = await BranchStockConfig.findOneAndUpdate(
      { branchId: String(branchId) },
      { $set: { cogsEnabled: true, cogsActivatedAt: new Date(), cogsActivatedBy: req.user?.id || 'system', cogsActivationNote: req.body?.note || null } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.status(200).json({ ok: true, config: cfg, readiness });
  } catch (error) {
    logger.error('Error activating COGS:', error);
    next(error instanceof HttpError ? error : new HttpError(500, 'Failed to activate COGS.'));
  }
};



const loadOpeningCylinderStock = async (req, res, next) => {
  try {
    const branchId = getBranchScope(req);
    const items = Array.isArray(req.body?.items) ? req.body.items : [{ size: req.body?.size, quantity: req.body?.quantity }];
    if (!items.length) throw new HttpError(400, 'At least one cylinder item is required.');
    const created = [];
    for (const it of items) {
      if (!hasVal(it.size)) throw new HttpError(400, 'Cylinder size is required.');
      const qty = toNum(it.quantity, NaN);
      if (!Number.isFinite(qty) || qty < 0) throw new HttpError(400, 'Cylinder quantity must be zero or greater.');
      const row = await Cylinder.create({
        id: new mongoose.Types.ObjectId().toString(),
        size: String(it.size).trim(),
        quantity: qty,
        branchId: branchId || undefined,
        openingStock: true,
        openingDate: parseDateSafe(req.body?.businessDate || req.body?.date || new Date()) || new Date(),
      });
      created.push(row);
    }
    return res.status(201).json({ ok: true, message: 'Opening cylinder stock loaded.', items: created });
  } catch (error) { logger.error('Error loading opening cylinder stock:', error); next(error instanceof HttpError ? error : new HttpError(500, 'Failed to load opening cylinder stock.')); }
};

module.exports = {
  getAssets,
  addAsset,
  deleteAsset,
  getLoans,
  addLoan,
  deleteLoan,
  getCylinders,
  addCylinder,
  deleteCylinder,
  addStockIn,
  getInventorySummary,
  getLpgStockInHistory,
  loadOpeningStock,
  getStockMovements,
  reconcileStock,
  getReconciliations,
  getGrossProfitReport,
  getBranchProfitabilityReport,
  listProducts,
  upsertProduct,
  listBranchPrices,
  upsertBranchPrice,
  getEffectivePrice,
  getBranchStockConfig,
  saveBranchStockConfig,
  postOpeningBalances,
  getCogsReadiness,
  activateCogs,
  loadOpeningCylinderStock,
};
