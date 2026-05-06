// src/api/v2/inventory/services/stockLedger.service.js
const mongoose = require('mongoose');
const StockIn = require('../../../../models/stockIn.model');
const StockMovement = require('../../../../models/stockMovement.model');
const StockReconciliation = require('../../../../models/stockReconciliation.model');
const { upsertJournal } = require('../../gl/services/journalUpsert.service');
const { getWacCostPerKgAsOf } = require('../../gl/services/wac.service');
const { DEFAULT_ACCOUNTS } = require('../../gl/services/coaMapping.service');
const { resolveBranchIdentity } = require('../../utils/branchIdentity');

const safeNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const hasVal = (v) => v !== undefined && v !== null && String(v).trim() !== '';

const parseDate = (v) => {
  if (!v) return null;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
  }
  const x = new Date(v);
  return x && !Number.isNaN(x.getTime()) ? x : null;
};

const endOfDay = (d) => {
  const x = parseDate(d) || new Date();
  x.setUTCHours(23, 59, 59, 999);
  return x;
};

const branchMatch = async (branchId) => {
  if (!hasVal(branchId)) return {};
  const identity = await resolveBranchIdentity(branchId);
  const aliases = identity.aliases.length ? identity.aliases : [String(branchId)];
  return { branchId: { $in: aliases } };
};

const getSystemStockKg = async (branchId) => {
  const rows = await StockIn.aggregate([
    { $match: await branchMatch(branchId) },
    { $group: { _id: null, qty: { $sum: '$remainingKg' }, stocked: { $sum: '$quantityKg' } } },
  ]);
  return { currentQtyKg: safeNum(rows?.[0]?.qty, 0), totalStockedKg: safeNum(rows?.[0]?.stocked, 0) };
};

const getStockValue = async (branchId) => {
  const rows = await StockIn.aggregate([
    { $match: await branchMatch(branchId) },
    { $project: { remainingKg: 1, costPerKg: 1 } },
  ]);
  return rows.reduce((sum, r) => sum + safeNum(r.remainingKg, 0) * safeNum(r.costPerKg, 0), 0);
};

const recordStockInMovement = async (stockIn, createdBy = null) => {
  if (!stockIn) return null;
  const branchId = String(stockIn.branchId);
  const qty = safeNum(stockIn.quantityKg, 0);
  const unitCost = safeNum(stockIn.costPerKg, 0);
  if (!branchId || qty <= 0) return null;
  const sourceType = String(stockIn.stockType || stockIn.type || '').toUpperCase() === 'OPENING_STOCK' ? 'OPENING_STOCK' : 'STOCK_IN';
  const movementType = sourceType === 'OPENING_STOCK' ? 'OPENING_STOCK' : 'STOCK_IN';
  const date = parseDate(stockIn.purchaseDate) || new Date();
  const existing = await StockMovement.findOne({ sourceType, sourceId: String(stockIn._id), movementType }).lean();
  if (existing) return existing;
  const snapshot = await getSystemStockKg(branchId);
  const value = await getStockValue(branchId);
  return StockMovement.create({
    branchId,
    movementDate: date,
    movementType,
    direction: 'IN',
    quantityKg: qty,
    unitCost,
    totalCost: qty * unitCost,
    runningQuantityKg: snapshot.currentQtyKg,
    runningValue: value,
    sourceType,
    sourceId: String(stockIn._id),
    sourceRef: stockIn.id || null,
    narration: movementType === 'OPENING_STOCK' ? 'Opening LPG stock loaded' : 'LPG stock-in receipt',
    createdBy,
  });
};

const issueStockFifo = async ({ branchId, qtyNeeded, date, movementType, sourceType, sourceId, sourceRef, narration, createdBy, meta = {} }) => {
  if (!branchId || safeNum(qtyNeeded, 0) <= 0) return { ok: true, skipped: true, reason: 'NO_KG_TO_DEPLETE' };

  const existing = await StockMovement.findOne({ sourceType, sourceId, movementType }).lean();
  if (existing) return { ok: true, skipped: true, reason: 'ALREADY_DEPLETED', movement: existing };

  let remainingToIssue = safeNum(qtyNeeded, 0);
  let issuedCost = 0;
  const batches = await StockIn.find({ ...(await branchMatch(branchId)), remainingKg: { $gt: 0 }, purchaseDate: { $lte: endOfDay(date) } })
    .sort({ purchaseDate: 1, createdAt: 1 })
    .lean();

  const allocations = [];
  for (const batch of batches) {
    if (remainingToIssue <= 0) break;
    const take = Math.min(safeNum(batch.remainingKg, 0), remainingToIssue);
    if (take <= 0) continue;
    const unit = safeNum(batch.costPerKg, 0);
    allocations.push({ stockInId: String(batch._id), quantityKg: take, costPerKg: unit, value: take * unit });
    issuedCost += take * unit;
    remainingToIssue -= take;
  }

  if (remainingToIssue > 0.0001) {
    return { ok: false, skipped: true, reason: 'INSUFFICIENT_STOCK', requestedKg: qtyNeeded, unfulfilledKg: remainingToIssue };
  }

  for (const a of allocations) {
    // eslint-disable-next-line no-await-in-loop
    await StockIn.updateOne({ _id: a.stockInId }, { $inc: { remainingKg: -a.quantityKg } });
  }

  const snapshot = await getSystemStockKg(branchId);
  const value = await getStockValue(branchId);
  const unitCost = qtyNeeded > 0 ? issuedCost / qtyNeeded : 0;
  const movement = await StockMovement.create({
    branchId,
    movementDate: date,
    movementType,
    direction: 'OUT',
    quantityKg: qtyNeeded,
    unitCost,
    totalCost: issuedCost,
    runningQuantityKg: snapshot.currentQtyKg,
    runningValue: value,
    sourceType,
    sourceId,
    sourceRef,
    narration,
    createdBy,
    meta: { ...meta, allocations },
  });

  return { ok: true, skipped: false, movement, issuedCost, unitCost, allocations };
};

const depleteStockForDailySummary = async (dailySummary, { createdBy = null } = {}) => {
  if (!dailySummary?._id) return { ok: false, skipped: true, reason: 'DAILY_SUMMARY_MISSING' };
  const branchId = String(dailySummary.branchId || dailySummary.serviceZoneId || '');
  const qtyNeeded = safeNum(dailySummary?.sales?.totalKgSold, 0);
  const date = parseDate(dailySummary.date) || new Date();
  return issueStockFifo({
    branchId,
    qtyNeeded,
    date,
    movementType: 'SALE_DEPLETION',
    sourceType: 'DAILY_SUMMARY',
    sourceId: String(dailySummary._id),
    sourceRef: dailySummary.dailySummaryId || null,
    narration: 'LPG stock depleted from approved POS daily sales',
    createdBy,
    meta: { dailySummaryId: dailySummary.dailySummaryId || null },
  });
};

const getOrderKgSold = (order) => {
  const direct = safeNum(order?.kgSold ?? order?.totalKgSold ?? order?.lpgKgSold ?? order?.lpgKg ?? order?.totalKg, NaN);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const meta = order?.metadata || {};
  const metaKg = safeNum(typeof meta.get === 'function' ? meta.get('kgSold') : (meta.kgSold ?? meta.totalKgSold ?? meta.lpgKg), NaN);
  if (Number.isFinite(metaKg) && metaKg > 0) return metaKg;
  if (Array.isArray(order?.items)) {
    return order.items.reduce((sum, item) => {
      const kg = safeNum(item?.kg ?? item?.quantityKg ?? item?.lpgKg ?? item?.weightKg, NaN);
      if (Number.isFinite(kg) && kg > 0) return sum + kg;
      return sum + safeNum(item?.quantity, 0);
    }, 0);
  }
  return 0;
};

const depleteStockForOrderDelivery = async (order, { createdBy = null } = {}) => {
  if (!order?._id) return { ok: false, skipped: true, reason: 'ORDER_MISSING' };
  const branchId = String(order.branchId || order.serviceZoneId || order.zoneId || order.plantId || '');
  const qtyNeeded = safeNum(getOrderKgSold(order), 0);
  const date = parseDate(order.orderDate || order.deliveredAt || order.createdAt) || new Date();
  return issueStockFifo({
    branchId,
    qtyNeeded,
    date,
    movementType: 'ORDER_DEPLETION',
    sourceType: 'ORDER',
    sourceId: String(order._id),
    sourceRef: order.id || null,
    narration: 'LPG stock depleted from delivered order',
    createdBy,
    meta: { orderId: order.id || null },
  });
};

const recordReconciliation = async ({ branchId, businessDate, physicalQtyKg, reason, createdBy, postVariance = false }) => {
  const date = parseDate(businessDate);
  if (!branchId) throw new Error('branchId is required');
  if (!date) throw new Error('businessDate is invalid');
  if (!reason || !String(reason).trim()) throw new Error('reason is required');
  const physical = safeNum(physicalQtyKg, NaN);
  if (!Number.isFinite(physical) || physical < 0) throw new Error('physicalQtyKg must be a valid non-negative number');

  const system = await getSystemStockKg(branchId);
  const wac = await getWacCostPerKgAsOf(branchId, date);
  const varianceKg = physical - system.currentQtyKg;
  const varianceValue = varianceKg * safeNum(wac.wac, 0);

  const rec = await StockReconciliation.create({
    branchId: String(branchId),
    businessDate: date,
    systemQtyKg: system.currentQtyKg,
    physicalQtyKg: physical,
    varianceKg,
    wacCostPerKg: safeNum(wac.wac, 0),
    varianceValue,
    reason: String(reason).trim(),
    createdBy: createdBy || null,
  });

  let movement = null;
  let gl = null;
  if (Math.abs(varianceKg) > 0.0001) {
    const direction = varianceKg > 0 ? 'IN' : 'OUT';
    const qty = Math.abs(varianceKg);
    movement = await StockMovement.create({
      branchId: String(branchId),
      movementDate: date,
      movementType: 'RECONCILIATION_VARIANCE',
      direction,
      quantityKg: qty,
      unitCost: safeNum(wac.wac, 0),
      totalCost: Math.abs(varianceValue),
      runningQuantityKg: physical,
      runningValue: physical * safeNum(wac.wac, 0),
      sourceType: 'STOCK_RECONCILIATION',
      sourceId: String(rec._id),
      sourceRef: rec.reconciliationId,
      narration: 'Physical stock reconciliation variance',
      createdBy,
    });

    if (varianceKg > 0) {
      await StockIn.create({
        id: new mongoose.Types.ObjectId().toString(),
        branchId: String(branchId),
        quantityKg: qty,
        remainingKg: qty,
        supplier: 'Stock reconciliation gain',
        purchaseDate: date,
        costPerKg: safeNum(wac.wac, 0) || 0.01,
        targetSalePricePerKg: safeNum(wac.wac, 0) || 0.01,
        stockType: 'RECONCILIATION_GAIN',
        loggedBy: { uid: createdBy || 'system', email: 'system@local' },
      });
    } else {
      let toDeduct = qty;
      const batches = await StockIn.find({ ...(await branchMatch(branchId)), remainingKg: { $gt: 0 } }).sort({ purchaseDate: 1, createdAt: 1 }).lean();
      for (const b of batches) {
        if (toDeduct <= 0) break;
        const take = Math.min(safeNum(b.remainingKg, 0), toDeduct);
        // eslint-disable-next-line no-await-in-loop
        await StockIn.updateOne({ _id: b._id }, { $inc: { remainingKg: -take } });
        toDeduct -= take;
      }
    }

    if (postVariance) {
      const lines = varianceKg < 0
        ? [
            { accountCode: DEFAULT_ACCOUNTS.INVENTORY_VARIANCE || '5100', debit: Math.abs(varianceValue), credit: 0, narration: 'Inventory shortage / shrinkage' },
            { accountCode: DEFAULT_ACCOUNTS.INVENTORY_LPG, debit: 0, credit: Math.abs(varianceValue), narration: 'Reduce LPG inventory' },
          ]
        : [
            { accountCode: DEFAULT_ACCOUNTS.INVENTORY_LPG, debit: Math.abs(varianceValue), credit: 0, narration: 'Increase LPG inventory' },
            { accountCode: DEFAULT_ACCOUNTS.INVENTORY_VARIANCE || '5100', debit: 0, credit: Math.abs(varianceValue), narration: 'Inventory gain' },
          ];
      gl = await upsertJournal({
        date,
        branchKey: String(branchId),
        sourceType: 'STOCK_RECONCILIATION',
        sourceId: String(rec._id),
        entryType: 'VARIANCE',
        narration: `Stock reconciliation variance ${rec.reconciliationId}`,
        lines,
        meta: { reconciliationId: rec.reconciliationId, reason: rec.reason },
      });
      rec.status = 'POSTED';
      rec.posting = { status: 'POSTED', glEntryIds: gl.glEntryIds || [], glEntryId: gl.glEntryIds?.[0] || null, postedAt: new Date(), postedBy: createdBy || null };
      await rec.save();
    }
  }

  return { reconciliation: rec, movement, gl };
};

const listMovements = async ({ branchId, startDate, endDate, movementType, limit = 100 }) => {
  const q = {};
  if (branchId) q.branchId = String(branchId);
  if (startDate || endDate) q.movementDate = {};
  if (startDate) q.movementDate.$gte = parseDate(startDate);
  if (endDate) q.movementDate.$lte = endOfDay(endDate);
  if (movementType) q.movementType = String(movementType).toUpperCase();
  return StockMovement.find(q).sort({ movementDate: -1, createdAt: -1 }).limit(Math.min(Number(limit) || 100, 500)).lean();
};

module.exports = {
  getSystemStockKg,
  getStockValue,
  recordStockInMovement,
  depleteStockForDailySummary,
  depleteStockForOrderDelivery,
  recordReconciliation,
  listMovements,
};
