// File: src/api/v2/gl/posting.service.js
// GL orchestrator: bootstrap COA, post approved operational documents, rebuild, retry, controls.

const mongoose = require('mongoose');
const ChartOfAccount = require('../../../models/chartOfAccount.model');
const GeneralLedgerEntry = require('../../../models/generalLedgerEntry.model');
const Order = require('../../../models/order.model');
const DailySummary = require('../../../models/dailySummary.model');
const ExpenseTransaction = require('../../../models/expenseTransaction.model');
const SaleTransaction = require('../../../models/saleTransaction.model');
const StockIn = require('../../../models/stockIn.model');
const StockMovement = require('../../../models/stockMovement.model');
const MigrationStagingRecord = require('../../../models/migrationStagingRecord.model');
const AccountingPeriod = require('../../../models/accountingPeriod.model');
const PostingBatch = require('../../../models/postingBatch.model');
const Plant = require('../../../models/plant.model');

const postDailySummaryPOS = require('./handlers/postDailySummaryPOS');
const postExpenseTransaction = require('./handlers/postExpenseTransaction');
const postStockIn = require('./handlers/postStockIn');
const postOrderDelivery = require('./handlers/postOrderDelivery');
const postReversal = require('./handlers/postReversal');
const { ensureDefaultCOA, DEFAULT_ACCOUNTS } = require('./services/coaMapping.service');
const { upsertJournal } = require('./services/journalUpsert.service');
const { recordStockInMovement, depleteStockForDailySummary, depleteStockForOrderDelivery } = require('../inventory/services/stockLedger.service');

const safeNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const hasVal = (v) => v !== undefined && v !== null && String(v).trim() !== '';

const asBool = (v, defaultValue = false) => {
  if (v === undefined || v === null || v === '') return Boolean(defaultValue);
  if (typeof v === 'boolean') return v;
  const val = String(v).trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(val)) return true;
  if (['false', '0', 'no', 'n'].includes(val)) return false;
  return Boolean(defaultValue);
};

const normalizeSettlementMode = (mode, fallback = 'ACTUAL') => {
  const raw = String(mode || fallback || 'ACTUAL').trim().toUpperCase();
  if (['SAME_DAY', 'SAME-DAY', 'C1', 'HISTORICAL_SAME_DAY', 'BANK_CENTRIC_C1'].includes(raw)) return 'SAME_DAY';
  return 'ACTUAL';
};

const normalizeHistoricalStockFundingMode = (mode, fallback = 'BANK') => {
  const raw = String(mode || fallback || 'BANK').trim().toUpperCase();
  if (['BANK', 'OPENING_EQUITY', 'ACCOUNTS_PAYABLE'].includes(raw)) return raw;
  return 'BANK';
};

const normalizeHistoricalCogsMode = (mode, fallback = 'STOCK_PURCHASE_FULL_COST') => {
  const raw = String(mode || fallback || 'STOCK_PURCHASE_FULL_COST').trim().toUpperCase();
  if (['STOCK_PURCHASE_FULL_COST', 'STOCK_PURCHASES_FULL_COST', 'PURCHASE_FULL_COST', 'PURCHASES_FULL_COST'].includes(raw)) return 'STOCK_PURCHASE_FULL_COST';
  if (['DAILY_SALES_WAC', 'OPERATIONAL_WAC', 'WAC'].includes(raw)) return 'DAILY_SALES_WAC';
  if (['NONE', 'DISABLED', 'OFF'].includes(raw)) return 'NONE';
  return 'STOCK_PURCHASE_FULL_COST';
};

const usesStockPurchaseHistoricalCogs = (ctx = {}) => normalizeHistoricalCogsMode(ctx.historicalCogsMode, 'DAILY_SALES_WAC') === 'STOCK_PURCHASE_FULL_COST';

const normalizeExpensePaymentOverride = (mode, fallback = '') => {
  const raw = String(mode || fallback || '').trim().toUpperCase();
  return raw === 'BANK' ? 'BANK' : '';
};

const parseBusinessDate = (d) => {
  if (!d) return null;
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const [y, m, day] = d.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, day, 0, 0, 0, 0));
  }
  const x = new Date(d);
  return x && !Number.isNaN(x.getTime()) ? x : null;
};

const toISODate = (d) => parseBusinessDate(d);

const startOfDay = (d) => {
  const x = parseBusinessDate(d) || new Date();
  x.setUTCHours(0, 0, 0, 0);
  return x;
};

const endOfDay = (d) => {
  const x = parseBusinessDate(d) || new Date();
  x.setUTCHours(23, 59, 59, 999);
  return x;
};

const periodKeyOf = (d) => {
  const x = parseBusinessDate(d) || new Date();
  return x.toISOString().slice(0, 7);
};

const assertPeriodOpenForDate = async (d, action = 'post') => {
  const periodKey = periodKeyOf(d);
  const period = await AccountingPeriod.findOne({ periodKey }).lean();
  if (period && period.status === 'LOCKED') {
    const e = new Error('Accounting period ' + periodKey + ' is locked. Reopen the period before attempting to ' + action + '.');
    e.code = 'PERIOD_LOCKED';
    e.periodKey = periodKey;
    throw e;
  }
  return { periodKey, status: period?.status || 'OPEN' };
};

const assertPeriodOpenForRange = async (start, end, action = 'post') => {
  const startKey = periodKeyOf(start);
  const endKey = periodKeyOf(end);
  const periods = await AccountingPeriod.find({ periodKey: { $gte: startKey, $lte: endKey }, status: 'LOCKED' }).lean();
  if (periods.length) {
    const e = new Error('Locked accounting period(s): ' + periods.map((p) => p.periodKey).join(', ') + '. Reopen before attempting to ' + action + '.');
    e.code = 'PERIOD_LOCKED';
    e.periodKeys = periods.map((p) => p.periodKey);
    throw e;
  }
};

const toBranchKey = (docOrId) => {
  if (!docOrId) return null;
  if (typeof docOrId === 'string') return docOrId;
  const v = docOrId.branchId ?? docOrId.serviceZoneId ?? docOrId.zoneId ?? docOrId.plantId ?? docOrId.branchKey ?? null;
  return v == null ? null : String(v);
};

const resolveBranchCandidates = async (branchKey) => {
  if (!hasVal(branchKey)) return { strings: [], objectIds: [], plant: null };
  const s = String(branchKey).trim();
  const stringSet = new Set([s]);
  const oidSet = new Map();

  const addOid = (v) => {
    if (!v) return;
    const str = String(v);
    if (mongoose.Types.ObjectId.isValid(str)) oidSet.set(str, new mongoose.Types.ObjectId(str));
  };
  const addString = (v) => {
    if (hasVal(v)) stringSet.add(String(v).trim());
  };

  addOid(s);

  let plant = null;
  try {
    const ors = [{ id: s }, { name: s }];
    if (mongoose.Types.ObjectId.isValid(s)) ors.push({ _id: new mongoose.Types.ObjectId(s) });
    plant = await Plant.findOne({ $or: ors }).lean();
  } catch (_) {
    plant = null;
  }

  if (plant) {
    addOid(plant._id);
    addString(plant._id);
    addString(plant.id);
    addString(plant.name);
  }

  return { strings: [...stringSet], objectIds: [...oidSet.values()], plant };
};

const buildBranchFilters = async (branchKey) => {
  if (!hasVal(branchKey)) {
    return { stock: {}, daily: {}, expense: {}, order: {}, gl: {}, batch: {}, displayKey: null };
  }

  const c = await resolveBranchCandidates(branchKey);
  const strings = c.strings || [];
  const objectIds = c.objectIds || [];
  const displayKey = c.plant?._id ? String(c.plant._id) : String(branchKey);

  const stringIn = strings.length ? { $in: strings } : null;
  const oidIn = objectIds.length ? { $in: objectIds } : null;

  const stringBranchFields = stringIn
    ? { $or: [{ branchId: stringIn }, { serviceZoneId: stringIn }, { zoneId: stringIn }, { plantId: stringIn }, { branchKey: stringIn }] }
    : { _id: { $exists: false } };

  const daily = oidIn ? { branchId: oidIn } : { _id: { $exists: false } };
  const stock = stringIn ? { branchId: stringIn } : { _id: { $exists: false } };
  const expense = stringIn ? { branchId: stringIn } : { _id: { $exists: false } };

  const orderOr = [];
  if (oidIn) orderOr.push({ branchId: oidIn });
  if (stringIn) orderOr.push({ serviceZoneId: stringIn }, { zoneId: stringIn }, { plantId: stringIn }, { branchKey: stringIn });
  const order = orderOr.length ? { $or: orderOr } : { _id: { $exists: false } };

  const gl = stringIn ? { branchKey: stringIn } : { _id: { $exists: false } };
  const batch = stringIn ? { branchKey: stringIn } : { _id: { $exists: false } };

  return { stock, daily, expense, order, gl, batch, stringBranchFields, displayKey, strings, objectIds };
};

const keyOfReason = (r) => String(r || 'UNKNOWN').toUpperCase();

const makeStats = () => ({
  posted: { STOCK_IN: 0, DAILY_SUMMARY: 0, ORDER: 0, EXPENSE: 0, STOCK_VARIANCE: 0, REVERSAL: 0 },
  skipped: { STOCK_IN: 0, DAILY_SUMMARY: 0, ORDER: 0, EXPENSE: 0, STOCK_VARIANCE: 0, REVERSAL: 0 },
  failed: { STOCK_IN: 0, DAILY_SUMMARY: 0, ORDER: 0, EXPENSE: 0, STOCK_VARIANCE: 0, REVERSAL: 0 },
  reasons: {},
  examples: {},
});

const bumpReason = (stats, code, id) => {
  const k = keyOfReason(code);
  stats.reasons[k] = (stats.reasons[k] || 0) + 1;
  if (!stats.examples[k]) stats.examples[k] = [];
  if (id && stats.examples[k].length < 10) stats.examples[k].push(String(id));
};

const normalizeHandlerResult = (raw = {}) => {
  if (raw.status) return raw;
  if (raw.posted === true) {
    const ids = [];
    if (raw.glEntryId) ids.push(String(raw.glEntryId));
    if (Array.isArray(raw.glEntryIds)) ids.push(...raw.glEntryIds.map(String));
    return { status: 'POSTED', glEntryIds: [...new Set(ids)], message: raw.message || 'Posted successfully' };
  }
  if (raw.skipped === true) {
    return { status: 'SKIPPED', reasonCode: raw.reason || raw.reasonCode || 'SKIPPED', message: raw.message || raw.reason || 'Skipped' };
  }
  return { status: 'FAILED', reasonCode: raw.reasonCode || 'FAILED', message: raw.message || 'Handler returned unsupported result' };
};

const getPostFunction = (handler) => {
  if (typeof handler === 'function') return handler;
  if (handler && typeof handler.post === 'function') return handler.post;
  if (handler && typeof handler.postStockIn === 'function') return handler.postStockIn;
  if (handler && typeof handler.postOrderDelivery === 'function') return handler.postOrderDelivery;
  if (handler && typeof handler.postDailySummaryPOS === 'function') return handler.postDailySummaryPOS;
  if (handler && typeof handler.postExpenseTransaction === 'function') return handler.postExpenseTransaction;
  return null;
};

const updateSourcePostingMeta = async ({ model, id, patch }) => {
  if (!model || !id || !patch) return;
  const $set = {};
  const $inc = {};
  if (patch.status !== undefined) $set['posting.status'] = patch.status;
  if (patch.glEntryId !== undefined) $set['posting.glEntryId'] = patch.glEntryId || null;
  if (patch.glEntryIds !== undefined) $set['posting.glEntryIds'] = patch.glEntryIds || [];
  if (patch.postedAt !== undefined) $set['posting.postedAt'] = patch.postedAt;
  if (patch.postedBy !== undefined) $set['posting.postedBy'] = patch.postedBy;
  if (patch.errorCode !== undefined) $set['posting.errorCode'] = patch.errorCode;
  if (patch.errorMessage !== undefined) $set['posting.errorMessage'] = patch.errorMessage;
  if (patch.version !== undefined) $set['posting.version'] = patch.version;
  if (typeof patch.attemptsInc === 'number') $inc['posting.attempts'] = patch.attemptsInc;
  const update = {};
  if (Object.keys($set).length) update.$set = $set;
  if (Object.keys($inc).length) update.$inc = $inc;
  if (Object.keys(update).length) await model.updateOne({ _id: id }, update);
};

const runOne = async ({ handler, model, doc, sourceType, stats, postedBy = 'system', ctx = {} }) => {
  const id = doc?._id;
  if (!ctx.dryRun) {
    try {
      await updateSourcePostingMeta({ model, id, patch: { status: 'QUEUED', postedBy, version: 1 } });
    } catch (_) {}
  }

  try {
    const postFn = getPostFunction(handler);
    if (!postFn) {
      const e = new Error('Posting handler is not callable');
      e.code = 'HANDLER_NOT_CALLABLE';
      throw e;
    }

    if (sourceType === 'DAILY_SUMMARY' && !ctx.dryRun && !usesStockPurchaseHistoricalCogs(ctx)) {
      // Create/confirm the StockMovement SALE_DEPLETION before posting the journal
      // so the DailySummary handler can source COGS from the same ledger used by
      // the Executive Dashboard. This is idempotent; existing depletion rows are reused.
      try { await depleteStockForDailySummary(doc, { createdBy: postedBy }); } catch (_) {}
    }

    const result = normalizeHandlerResult(await postFn(doc, { postedBy, ...ctx }));
    const status = String(result.status || 'FAILED').toUpperCase();
    const glEntryIds = Array.isArray(result.glEntryIds) ? result.glEntryIds.map(String) : [];

    if (status === 'POSTED') {
      stats.posted[sourceType] += 1;
      if (!ctx.dryRun) {
        const postedAt = new Date();
        await updateSourcePostingMeta({
          model,
          id,
          patch: {
            status: 'POSTED',
            glEntryIds,
            glEntryId: glEntryIds[0] || null,
            errorCode: null,
            errorMessage: null,
            postedAt,
            postedBy,
            attemptsInc: 1,
            version: 1,
          },
        });

        // DailySummary is posted as the aggregated POS sales source.
        // Mark linked SaleTransaction rows as POSTED for traceability only; they are not posted again as separate GL journals.
        if (sourceType === 'DAILY_SUMMARY' && id) {
          if (!usesStockPurchaseHistoricalCogs(ctx)) { try { await depleteStockForDailySummary(doc, { createdBy: postedBy }); } catch (_) {} }
          await SaleTransaction.updateMany(
            { dailySummaryId: id },
            {
              $set: {
                'posting.status': 'POSTED',
                'posting.glEntryIds': glEntryIds,
                'posting.glEntryId': glEntryIds[0] || null,
                'posting.postedAt': postedAt,
                'posting.postedBy': postedBy,
                'posting.errorCode': null,
                'posting.errorMessage': null,
                'posting.version': 1,
              },
              $inc: { 'posting.attempts': 1 },
            }
          );
        }
      }
      if (sourceType === 'STOCK_IN' && !ctx.dryRun) { try { await recordStockInMovement(doc, postedBy); } catch (_) {} }
      if (sourceType === 'ORDER' && !ctx.dryRun) { try { await depleteStockForOrderDelivery(doc, { createdBy: postedBy }); } catch (_) {} }
      return { ok: true, status: 'POSTED', sourceType, sourceId: id ? String(id) : null, glEntryIds };
    }

    if (status === 'SKIPPED') {
      stats.skipped[sourceType] += 1;
      const reason = keyOfReason(result.reasonCode || 'SKIPPED');
      bumpReason(stats, reason, id);
      if (!ctx.dryRun) await updateSourcePostingMeta({
        model,
        id,
        patch: {
          status: 'SKIPPED',
          glEntryIds: [],
          glEntryId: null,
          errorCode: reason,
          errorMessage: result.message || 'Skipped',
          postedAt: null,
          postedBy,
          attemptsInc: 1,
          version: 1,
        },
      });
      return { ok: true, status: 'SKIPPED', sourceType, sourceId: id ? String(id) : null, reasonCode: reason };
    }

    stats.failed[sourceType] += 1;
    const reason = keyOfReason(result.reasonCode || 'FAILED');
    bumpReason(stats, reason, id);
    if (!ctx.dryRun) await updateSourcePostingMeta({
      model,
      id,
      patch: {
        status: 'FAILED',
        glEntryIds: [],
        glEntryId: null,
        errorCode: reason,
        errorMessage: result.message || 'Posting failed',
        postedAt: null,
        postedBy,
        attemptsInc: 1,
        version: 1,
      },
    });
    return { ok: false, status: 'FAILED', sourceType, sourceId: id ? String(id) : null, reasonCode: reason };
  } catch (e) {
    stats.failed[sourceType] += 1;
    const reason = keyOfReason(e.code || e.name || 'EXCEPTION');
    bumpReason(stats, reason, id);
    if (!ctx.dryRun) await updateSourcePostingMeta({
      model,
      id,
      patch: {
        status: 'FAILED',
        glEntryIds: [],
        glEntryId: null,
        errorCode: reason,
        errorMessage: e.message || String(e),
        postedAt: null,
        postedBy,
        attemptsInc: 1,
        version: 1,
      },
    });
    return { ok: false, status: 'FAILED', sourceType, sourceId: id ? String(id) : null, reasonCode: reason };
  }
};

const bootstrap = async () => {
  const seed = await ensureDefaultCOA();
  const count = await ChartOfAccount.countDocuments({ isActive: true });
  return { ok: true, seeded: seed.count, insertedOrExisting: count };
};

const buildStockMatch = ({ startIncl, endIncl, branchMatch }) => ({ ...branchMatch, purchaseDate: { $gte: startIncl, $lte: endIncl } });
const buildDailyMatch = ({ startIncl, endIncl, branchMatch, requireApproved = false }) => {
  const q = { ...branchMatch, date: { $gte: startIncl, $lte: endIncl } };
  if (requireApproved) q.status = 'approved';
  return q;
};
const buildExpenseMatch = ({ startIncl, endIncl, branchMatch, requireApproved = false }) => {
  const q = { ...branchMatch, date: { $gte: startIncl, $lte: endIncl } };
  if (requireApproved) q.status = { $in: ['approved', 'Approved', 'APPROVED'] };
  return q;
};
const buildOrderMatch = ({ startIncl, endIncl, branchMatch, requireDelivered = false }) => {
  const and = [
    { $or: [{ orderDate: { $gte: startIncl, $lte: endIncl } }, { orderDate: { $exists: false }, createdAt: { $gte: startIncl, $lte: endIncl } }] },
    { $or: [{ channel: { $exists: false } }, { channel: 'DELIVERY' }] },
  ];
  if (requireDelivered) and.push({ status: 'Delivered' });
  return { ...branchMatch, $and: and };
};

const loadDocs = async ({ startIncl, endIncl, branchKey, requireApproved, includeOrders = false }) => {
  const filters = await buildBranchFilters(branchKey);
  const [stockIns, dailies, expenses] = await Promise.all([
    StockIn.find(buildStockMatch({ startIncl, endIncl, branchMatch: filters.stock })).lean(),
    DailySummary.find(buildDailyMatch({ startIncl, endIncl, branchMatch: filters.daily, requireApproved })).lean(),
    ExpenseTransaction.find(buildExpenseMatch({ startIncl, endIncl, branchMatch: filters.expense, requireApproved })).lean(),
  ]);
  const orders = includeOrders
    ? await Order.find(buildOrderMatch({ startIncl, endIncl, branchMatch: filters.order, requireDelivered: requireApproved })).lean()
    : [];
  return [stockIns, dailies, orders, expenses];
};



const normalizeVarianceSource = (m = {}) => {
  const n = m.normalized || {};
  const isStaging = m.__sourceKind === 'MIGRATION_STAGING' || m.recordType === 'STOCK_VARIANCE';
  const qty = isStaging ? safeNum(n.quantityKg, 0) : safeNum(m.quantityKg, 0);
  const unitCost = isStaging ? safeNum(n.estimatedCostPerKg, 0) : safeNum(m.unitCost, 0);
  const totalCost = isStaging ? safeNum(n.estimatedValue, qty * unitCost) : safeNum(m.totalCost, qty * unitCost);
  const direction = String(isStaging ? (n.direction || 'OUT') : (m.direction || 'OUT')).toUpperCase();
  const date = parseBusinessDate(isStaging ? (n.varianceDate || m.businessDate) : m.movementDate);
  const sourceId = isStaging ? `STAGING:${String(m._id)}` : String(m._id || '');
  const branch = isStaging
    ? String(m.branchObjectId || n.branchObjectId || n.branchCode || m.branchCode || '')
    : String(m.branchId || '');
  return {
    _varianceSourceKind: isStaging ? 'MIGRATION_STAGING' : 'STOCK_MOVEMENT',
    _varianceSourceId: sourceId,
    _varianceDate: date,
    _varianceBranch: branch,
    _varianceQuantityKg: qty,
    _varianceUnitCost: unitCost,
    _varianceTotalCost: totalCost,
    _varianceDirection: direction,
    _varianceNarration: isStaging ? (n.reason || 'Historical stock variance from migration staging') : (m.narration || 'Historical stock variance'),
    _varianceRef: isStaging ? (m.duplicateKey || null) : (m.movementId || m.sourceRef || null),
    _varianceMeta: isStaging
      ? { stagingRecordId: String(m._id), duplicateKey: m.duplicateKey || null, batchId: m.batchId || null, branchCode: n.branchCode || m.branchCode || null, linkedBusinessDate: n.linkedBusinessDate || null, notes: n.notes || null }
      : { movementId: m.movementId || null, movementType: m.movementType, sourceType: m.sourceType, sourceId: m.sourceId, sourceRef: m.sourceRef || null, meta: m.meta || {} },
  };
};

const loadStockVarianceMovements = async ({ startIncl, endIncl, branchKey }) => {
  const filters = await buildBranchFilters(branchKey);
  const movementMatch = {
    ...(branchKey ? filters.stock : {}),
    movementDate: { $gte: startIncl, $lte: endIncl },
    movementType: 'RECONCILIATION_VARIANCE',
  };
  const movements = await StockMovement.find(movementMatch).lean();

  // Safety net for historical migrations: variances live in 06_stock_variances.csv and
  // should post separately to account 5100. If an imported staging variance exists but
  // its StockMovement was not created or cannot be found, include the staging row once
  // as a virtual variance source. This prevents the variance from being swallowed into
  // DailySummary/COGS or silently omitted from GL rebuild.
  const existingMovementIds = new Set((movements || []).map((m) => String(m._id)));
  const existingMovementRefs = new Set((movements || []).map((m) => String(m.sourceRef || '')).filter(Boolean));
  const stagingMatch = {
    recordType: 'STOCK_VARIANCE',
    importStatus: 'IMPORTED',
    businessDate: { $gte: startIncl, $lte: endIncl },
  };
  if (branchKey && filters.strings?.length) {
    stagingMatch.$or = [
      { branchCode: { $in: filters.strings } },
      { branchObjectId: { $in: filters.objectIds || [] } },
    ];
  }
  const stagingRows = await MigrationStagingRecord.find(stagingMatch).lean().catch(() => []);
  const fallbackRows = (stagingRows || [])
    .filter((r) => {
      const importedId = String(r.importedId || '');
      const duplicateKey = String(r.duplicateKey || '');
      return !(importedId && existingMovementIds.has(importedId)) && !(duplicateKey && existingMovementRefs.has(duplicateKey));
    })
    .map((r) => ({ ...r, __sourceKind: 'MIGRATION_STAGING' }));

  return [...(movements || []), ...fallbackRows];
};

const postStockVarianceMovements = async ({ startIncl, endIncl, branchKey, stats, postedBy = 'system', ctx = {}, movements: providedMovements = null }) => {
  const movements = Array.isArray(providedMovements) ? providedMovements : await loadStockVarianceMovements({ startIncl, endIncl, branchKey });
  const results = [];

  for (const raw of movements || []) {
    const m = normalizeVarianceSource(raw);
    const id = m._varianceSourceId || null;
    const amount = safeNum(m._varianceTotalCost, 0);
    if (!id || amount <= 0) {
      stats.skipped.STOCK_VARIANCE += 1;
      bumpReason(stats, 'STOCK_VARIANCE_ZERO_OR_INVALID', id);
      results.push({ ok: true, status: 'SKIPPED', sourceType: 'STOCK_VARIANCE', sourceId: id, reasonCode: 'STOCK_VARIANCE_ZERO_OR_INVALID' });
      ctx.processedRows = safeNum(ctx.processedRows, 0) + 1;
      await emitRebuildProgress(ctx, { stage: 'POSTED_STOCK_VARIANCE', sourceType: 'STOCK_VARIANCE', total: safeNum(ctx.totalRows, 0), processedRows: ctx.processedRows, currentSourceId: id, stats });
      continue;
    }

    const date = m._varianceDate || startIncl;
    const direction = String(m._varianceDirection || 'OUT').toUpperCase();
    const branch = String(m._varianceBranch || branchKey || '');
    const isLoss = direction === 'OUT';
    // Historical stock variance rows come from expected-sales-vs-actual-collections
    // analysis. They are a cash/tender variance reclassification, not another LPG
    // inventory movement. Therefore, do NOT credit/debit 1200 here; reclassify
    // between 1030 Cash Over/Short and 5100 Inventory Variance/Shrinkage.
    const lines = isLoss
      ? [
          { accountCode: DEFAULT_ACCOUNTS.INVENTORY_VARIANCE || '5100', debit: amount, credit: 0, narration: 'Reclass shortage/loss to Inventory Variance / Shrinkage' },
          { accountCode: DEFAULT_ACCOUNTS.CASH_OVER_SHORT || '1030', debit: 0, credit: amount, narration: 'Clear shortage from Cash Over / Short' },
        ]
      : [
          { accountCode: DEFAULT_ACCOUNTS.CASH_OVER_SHORT || '1030', debit: amount, credit: 0, narration: 'Clear overage through Cash Over / Short' },
          { accountCode: DEFAULT_ACCOUNTS.INVENTORY_VARIANCE || '5100', debit: 0, credit: amount, narration: 'Reclass inventory/tender overage gain' },
        ];

    if (ctx.dryRun) {
      stats.posted.STOCK_VARIANCE += 1;
      results.push({ ok: true, status: 'POSTED', sourceType: 'STOCK_VARIANCE', sourceId: id, glEntryIds: [], dryRun: true });
      ctx.processedRows = safeNum(ctx.processedRows, 0) + 1;
      await emitRebuildProgress(ctx, { stage: 'POSTED_STOCK_VARIANCE', sourceType: 'STOCK_VARIANCE', total: safeNum(ctx.totalRows, 0), processedRows: ctx.processedRows, currentSourceId: id, stats });
      continue;
    }

    try {
      const gl = await upsertJournal({
        date,
        branchKey: branch,
        sourceType: 'STOCK_VARIANCE',
        sourceId: id,
        entryType: 'VARIANCE',
        narration: `Stock variance movement ${m._varianceRef || id}`,
        lines,
        meta: { ...(m._varianceMeta || {}), varianceSourceKind: m._varianceSourceKind, movementType: 'RECONCILIATION_VARIANCE', direction, postingBatchId: ctx.postingBatchId || null, quantityKg: m._varianceQuantityKg, unitCost: m._varianceUnitCost },
      });
      stats.posted.STOCK_VARIANCE += 1;
      results.push({ ok: true, status: 'POSTED', sourceType: 'STOCK_VARIANCE', sourceId: id, glEntryIds: gl.glEntryIds || [] });
      ctx.processedRows = safeNum(ctx.processedRows, 0) + 1;
      await emitRebuildProgress(ctx, { stage: 'POSTED_STOCK_VARIANCE', sourceType: 'STOCK_VARIANCE', total: safeNum(ctx.totalRows, 0), processedRows: ctx.processedRows, currentSourceId: id, stats });
    } catch (e) {
      stats.failed.STOCK_VARIANCE += 1;
      const reason = keyOfReason(e.code || e.name || 'STOCK_VARIANCE_POSTING_FAILED');
      bumpReason(stats, reason, id);
      results.push({ ok: false, status: 'FAILED', sourceType: 'STOCK_VARIANCE', sourceId: id, reasonCode: reason, message: e.message || String(e) });
      ctx.processedRows = safeNum(ctx.processedRows, 0) + 1;
      await emitRebuildProgress(ctx, { stage: 'FAILED_STOCK_VARIANCE', sourceType: 'STOCK_VARIANCE', total: safeNum(ctx.totalRows, 0), processedRows: ctx.processedRows, currentSourceId: id, stats });
    }
  }

  return { movements, results };
};

const emitRebuildProgress = async (ctx = {}, payload = {}) => {
  if (typeof ctx.onProgress !== 'function') return;
  try { await ctx.onProgress(payload); } catch (_) {}
};

const postDocs = async ({ stockIns, dailies, orders, expenses, stats, postedBy, ctx }) => {
  const results = [];
  let processed = safeNum(ctx?.processedRows, 0);
  const total = safeNum(ctx?.totalRows, 0);
  const runAndPush = async (args) => {
    await emitRebuildProgress(ctx, { stage: `POSTING_${args.sourceType}`, sourceType: args.sourceType, total, processedRows: processed, currentSourceId: args.doc?._id ? String(args.doc._id) : null });
    const r = await runOne(args);
    results.push(r);
    processed += 1;
    ctx.processedRows = processed;
    await emitRebuildProgress(ctx, { stage: `POSTED_${args.sourceType}`, sourceType: args.sourceType, total, processedRows: processed, currentSourceId: args.doc?._id ? String(args.doc._id) : null, stats });
    return r;
  };
  for (const s of stockIns || []) await runAndPush({ handler: postStockIn, model: StockIn, doc: s, sourceType: 'STOCK_IN', stats, postedBy, ctx });
  for (const d of dailies || []) await runAndPush({ handler: postDailySummaryPOS, model: DailySummary, doc: d, sourceType: 'DAILY_SUMMARY', stats, postedBy, ctx });
  for (const o of orders || []) await runAndPush({ handler: postOrderDelivery, model: Order, doc: o, sourceType: 'ORDER', stats, postedBy, ctx });
  for (const e of expenses || []) await runAndPush({ handler: postExpenseTransaction, model: ExpenseTransaction, doc: e, sourceType: 'EXPENSE', stats, postedBy, ctx });
  return results;
};

const createBatch = async ({ action, branchKey, startDate, endDate, businessDate, requestedBy }) => PostingBatch.create({ action, branchKey, startDate, endDate, businessDate, requestedBy, status: 'STARTED' });

const finalizeBatch = async (batch, { found, stats, results, errorMessage = null }) => {
  if (!batch) return null;
  const journalIds = [...new Set((results || []).flatMap((r) => Array.isArray(r.glEntryIds) ? r.glEntryIds.map(String) : []))];
  const failedTotal = Object.values(stats?.failed || {}).reduce((a, b) => a + safeNum(b, 0), 0);
  batch.status = errorMessage ? 'FAILED' : (failedTotal > 0 ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED');
  batch.found = found || {};
  batch.stats = stats || {};
  batch.results = results || [];
  batch.journalIds = journalIds;
  batch.errorMessage = errorMessage || null;
  batch.completedAt = new Date();
  await batch.save();
  return batch;
};

const rebuild = async ({ startDate, endDate, branchId = null, dryRun = false, postedBy = 'system', onProgress = null, settlementMode = null, historicalStockFundingMode = null, historicalCogsMode = null, forceExpensePaymentAccount = null, accountingPolicy = null, includeOrders = false } = {}) => {
  const start = toISODate(startDate);
  const end = toISODate(endDate);
  if (!start || !end) { const e = new Error('Invalid startDate/endDate'); e.code = 'BAD_DATES'; throw e; }
  const startIncl = startOfDay(start);
  const endIncl = endOfDay(end);
  const branchKey = hasVal(branchId) ? String(branchId) : null;
  const resolvedIncludeOrders = asBool(includeOrders, false);
  const resolvedSettlementMode = normalizeSettlementMode(settlementMode, process.env.GL_REBUILD_SETTLEMENT_MODE || 'SAME_DAY');
  const resolvedHistoricalStockFundingMode = normalizeHistoricalStockFundingMode(historicalStockFundingMode, process.env.GL_HISTORICAL_STOCK_FUNDING_MODE || 'BANK');
  const resolvedHistoricalCogsMode = normalizeHistoricalCogsMode(historicalCogsMode, process.env.GL_HISTORICAL_COGS_MODE || 'STOCK_PURCHASE_FULL_COST');
  const resolvedForceExpensePaymentAccount = normalizeExpensePaymentOverride(forceExpensePaymentAccount, process.env.GL_REBUILD_FORCE_EXPENSE_PAYMENT_ACCOUNT || 'BANK');
  const resolvedAccountingPolicy = accountingPolicy || 'OPTION_C_BANK_CENTRIC_WORKING_CAPITAL';
  const emit = async (payload) => {
    if (typeof onProgress !== 'function') return;
    try { await onProgress(payload); } catch (_) {}
  };

  await emit({ stage: 'VALIDATING_PERIOD', total: 0, processedRows: 0, message: `Checking selected date range. Policy=${resolvedAccountingPolicy}; settlement=${resolvedSettlementMode}; stockFunding=${resolvedHistoricalStockFundingMode}; historicalCogs=${resolvedHistoricalCogsMode}; expensePayment=${resolvedForceExpensePaymentAccount || 'SOURCE'}; orders=${resolvedIncludeOrders ? 'INCLUDED' : 'EXCLUDED'}.` });
  if (!dryRun) await assertPeriodOpenForRange(startIncl, endIncl, 'rebuild GL');
  let batch = null;
  if (!dryRun) batch = await createBatch({ action: 'REBUILD', branchKey, startDate: startIncl, endDate: endIncl, requestedBy: postedBy });

  let found = {};
  try {
    await emit({ stage: 'LOADING_SOURCE_DOCUMENTS', total: 0, processedRows: 0, message: resolvedIncludeOrders ? 'Loading StockIn, DailySummary, Order, Expense and stock-variance records.' : 'Loading StockIn, DailySummary, Expense and stock-variance records. Orders are excluded by GL policy.' });
    const [stockIns, dailies, orders, expenses] = await loadDocs({ startIncl, endIncl, branchKey, requireApproved: false, includeOrders: resolvedIncludeOrders });
    const varianceMovements = await loadStockVarianceMovements({ startIncl, endIncl, branchKey });
    found = { stockIns: stockIns.length, dailies: dailies.length, orders: resolvedIncludeOrders ? orders.length : 0, ordersExcludedByPolicy: resolvedIncludeOrders ? 0 : null, expenses: expenses.length, stockVariances: (varianceMovements || []).length };
    const totalRows = found.stockIns + found.dailies + (resolvedIncludeOrders ? found.orders : 0) + found.expenses + found.stockVariances;
    await emit({ stage: 'SOURCE_DOCUMENTS_LOADED', total: totalRows, processedRows: 0, found, message: `Loaded ${totalRows} source record(s) for GL ${dryRun ? 'dry run' : 'rebuild'}.` });

    if (!dryRun) {
      await emit({ stage: 'DELETING_EXISTING_GL', total: totalRows, processedRows: 0, found, message: 'Deleting existing GL entries in selected range before rebuild.' });
      const delFilter = { date: { $gte: startIncl, $lte: endIncl } };
      if (branchKey) delFilter.branchKey = branchKey;
      await GeneralLedgerEntry.deleteMany(delFilter);
    }

    const stats = makeStats();
    const ctx = { dryRun: Boolean(dryRun), branchKey, postingBatchId: batch?.batchId || null, onProgress, totalRows, processedRows: 0, settlementMode: resolvedSettlementMode, historicalStockFundingMode: resolvedHistoricalStockFundingMode, historicalCogsMode: resolvedHistoricalCogsMode, forceExpensePaymentAccount: resolvedForceExpensePaymentAccount, accountingPolicy: resolvedAccountingPolicy, includeOrders: resolvedIncludeOrders };
    const results = await postDocs({ stockIns, dailies, orders, expenses, stats, postedBy, ctx });
    const variancePost = await postStockVarianceMovements({ startIncl, endIncl, branchKey, stats, postedBy, ctx, movements: varianceMovements });
    results.push(...(variancePost.results || []));
    await emit({ stage: 'FINALIZING_BATCH', total: totalRows, processedRows: totalRows, found, stats, message: 'Finalizing posting batch and summary.' });
    const savedBatch = await finalizeBatch(batch, { found, stats, results });
    const response = { ok: true, dryRun: Boolean(dryRun), batchId: savedBatch?.batchId || null, start: startIncl.toISOString(), end: endIncl.toISOString(), branchId: branchKey, accountingPolicy: resolvedAccountingPolicy, settlementMode: resolvedSettlementMode, historicalStockFundingMode: resolvedHistoricalStockFundingMode, historicalCogsMode: resolvedHistoricalCogsMode, forceExpensePaymentAccount: resolvedForceExpensePaymentAccount || null, includeOrders: resolvedIncludeOrders, orderPostingPolicy: resolvedIncludeOrders ? 'INCLUDED_BY_REQUEST' : 'EXCLUDED_BY_DEFAULT', found, ...stats };
    await emit({ stage: 'COMPLETED', total: totalRows, processedRows: totalRows, found, stats, result: response, message: 'GL rebuild completed.' });
    return response;
  } catch (e) {
    await finalizeBatch(batch, { found, stats: makeStats(), results: [], errorMessage: e.message });
    await emit({ stage: 'FAILED', total: 0, processedRows: 0, found, error: e.message || String(e), message: e.message || 'GL rebuild failed.' });
    throw e;
  }
};

const postApproved = async ({ date, businessDate, branchId = null, postedBy = 'system', includeOrders = false }) => {
  const d = toISODate(date || businessDate);
  if (!d) { const e = new Error('Invalid date'); e.code = 'BAD_DATE'; throw e; }
  const start = startOfDay(d);
  const end = endOfDay(d);
  await assertPeriodOpenForDate(start, 'post approved records');
  const branchKey = hasVal(branchId) ? String(branchId) : null;
  const batch = await createBatch({ action: 'POST_APPROVED', branchKey, businessDate: start, startDate: start, endDate: end, requestedBy: postedBy });
  try {
    const includeOrderDocs = asBool(includeOrders, false);
    const [stockIns, dailies, orders, expenses] = await loadDocs({ startIncl: start, endIncl: end, branchKey, requireApproved: true, includeOrders: includeOrderDocs });
    const stats = makeStats();
    const ctx = { dryRun: false, branchKey, postingBatchId: batch.batchId, settlementMode: normalizeSettlementMode(process.env.GL_POST_APPROVED_SETTLEMENT_MODE, 'ACTUAL'), historicalStockFundingMode: normalizeHistoricalStockFundingMode(process.env.GL_HISTORICAL_STOCK_FUNDING_MODE, 'BANK'), forceExpensePaymentAccount: normalizeExpensePaymentOverride(process.env.GL_POST_APPROVED_FORCE_EXPENSE_PAYMENT_ACCOUNT, ''), accountingPolicy: 'OPTION_C_PRODUCTION_ACTUAL_SETTLEMENT', includeOrders: includeOrderDocs };
    const results = await postDocs({ stockIns, dailies, orders, expenses, stats, postedBy, ctx });
    const variancePost = await postStockVarianceMovements({ startIncl: start, endIncl: end, branchKey, stats, postedBy, ctx });
    results.push(...(variancePost.results || []));
    const found = { stockIns: stockIns.length, dailies: dailies.length, orders: includeOrderDocs ? orders.length : 0, ordersExcludedByPolicy: includeOrderDocs ? 0 : null, expenses: expenses.length, stockVariances: (variancePost.movements || []).length };
    const savedBatch = await finalizeBatch(batch, { found, stats, results });
    return { ok: true, batchId: savedBatch?.batchId || batch.batchId, date: start.toISOString().slice(0, 10), branchId: branchKey, includeOrders: includeOrderDocs, orderPostingPolicy: includeOrderDocs ? 'INCLUDED_BY_REQUEST' : 'EXCLUDED_BY_DEFAULT', found, ...stats };
  } catch (e) {
    await finalizeBatch(batch, { found: {}, stats: makeStats(), results: [], errorMessage: e.message });
    throw e;
  }
};

const retryFailed = async ({ startDate, endDate, branchId = null, postedBy = 'system', includeOrders = false }) => {
  const start = toISODate(startDate);
  const end = toISODate(endDate);
  if (!start || !end) { const e = new Error('Invalid startDate/endDate'); e.code = 'BAD_DATES'; throw e; }
  const startIncl = startOfDay(start);
  const endIncl = endOfDay(end);
  await assertPeriodOpenForRange(startIncl, endIncl, 'retry failed postings');
  const branchKey = hasVal(branchId) ? String(branchId) : null;
  const includeOrderDocs = asBool(includeOrders, false);
  const batch = await createBatch({ action: 'RETRY_FAILED', branchKey, startDate: startIncl, endDate: endIncl, requestedBy: postedBy });
  try {
    const filters = await buildBranchFilters(branchKey);
    const [stockIns, dailies, expenses] = await Promise.all([
      StockIn.find({ ...buildStockMatch({ startIncl, endIncl, branchMatch: filters.stock }), 'posting.status': 'FAILED' }).lean(),
      DailySummary.find({ ...buildDailyMatch({ startIncl, endIncl, branchMatch: filters.daily, requireApproved: false }), 'posting.status': 'FAILED' }).lean(),
      ExpenseTransaction.find({ ...buildExpenseMatch({ startIncl, endIncl, branchMatch: filters.expense, requireApproved: false }), 'posting.status': 'FAILED' }).lean(),
    ]);
    const orders = includeOrderDocs
      ? await Order.find({ ...buildOrderMatch({ startIncl, endIncl, branchMatch: filters.order, requireDelivered: false }), 'posting.status': 'FAILED' }).lean()
      : [];
    const stats = makeStats();
    const results = await postDocs({ stockIns, dailies, orders, expenses, stats, postedBy, ctx: { dryRun: false, branchKey, postingBatchId: batch.batchId, settlementMode: normalizeSettlementMode(process.env.GL_POST_APPROVED_SETTLEMENT_MODE, 'ACTUAL'), historicalStockFundingMode: normalizeHistoricalStockFundingMode(process.env.GL_HISTORICAL_STOCK_FUNDING_MODE, 'BANK'), forceExpensePaymentAccount: normalizeExpensePaymentOverride(process.env.GL_POST_APPROVED_FORCE_EXPENSE_PAYMENT_ACCOUNT, ''), accountingPolicy: 'OPTION_C_PRODUCTION_ACTUAL_SETTLEMENT', includeOrders: includeOrderDocs } });
    const found = { stockIns: stockIns.length, dailies: dailies.length, orders: includeOrderDocs ? orders.length : 0, ordersExcludedByPolicy: includeOrderDocs ? 0 : null, expenses: expenses.length };
    const savedBatch = await finalizeBatch(batch, { found, stats, results });
    return { ok: true, batchId: savedBatch?.batchId || batch.batchId, start: startIncl.toISOString(), end: endIncl.toISOString(), branchId: branchKey, includeOrders: includeOrderDocs, orderPostingPolicy: includeOrderDocs ? 'INCLUDED_BY_REQUEST' : 'EXCLUDED_BY_DEFAULT', found, ...stats };
  } catch (e) {
    await finalizeBatch(batch, { found: {}, stats: makeStats(), results: [], errorMessage: e.message });
    throw e;
  }
};

const trialBalance = async ({ startDate, endDate, branchId = null }) => {
  const start = toISODate(startDate);
  const end = toISODate(endDate);
  if (!start || !end) {
    const e = new Error('Invalid startDate/endDate');
    e.code = 'BAD_DATES';
    throw e;
  }
  const startIncl = startOfDay(start);
  const endIncl = endOfDay(end);
  const branchKey = hasVal(branchId) ? String(branchId) : null;
  const filters = await buildBranchFilters(branchKey);
  const match = { status: 'POSTED', date: { $gte: startIncl, $lte: endIncl }, ...(branchKey ? filters.gl : {}) };
  const rows = await GeneralLedgerEntry.aggregate([
    { $match: match },
    { $unwind: '$lines' },
    { $group: { _id: '$lines.accountCode', debit: { $sum: '$lines.debit' }, credit: { $sum: '$lines.credit' } } },
    { $sort: { _id: 1 } },
  ]);
  const coa = await ChartOfAccount.find({ isActive: true }).lean();
  const coaMap = new Map(coa.map((a) => [String(a.accountCode), a]));
  const shaped = rows.map((r) => {
    const meta = coaMap.get(String(r._id)) || null;
    const debit = safeNum(r.debit, 0);
    const credit = safeNum(r.credit, 0);
    const balance = meta?.normalBalance === 'CREDIT' ? credit - debit : debit - credit;
    return { accountCode: String(r._id), accountName: meta?.name || 'Unknown', accountType: meta?.type || 'UNKNOWN', normalBalance: meta?.normalBalance || null, debit, credit, balance };
  });
  const totals = shaped.reduce((acc, r) => ({ debit: acc.debit + r.debit, credit: acc.credit + r.credit }), { debit: 0, credit: 0 });
  const diff = Math.abs(totals.debit - totals.credit);
  return { ok: diff <= 0.5, totals, diff, rows: shaped, period: { start: startIncl, end: endIncl }, branch: { branchId: branchKey } };
};

const postingExceptions = async ({ startDate, endDate, branchId = null, includeOrders = false }) => {
  const start = toISODate(startDate);
  const end = toISODate(endDate);
  if (!start || !end) {
    const e = new Error('Invalid startDate/endDate');
    e.code = 'BAD_DATES';
    throw e;
  }
  const startIncl = startOfDay(start);
  const endIncl = endOfDay(end);
  const branchKey = hasVal(branchId) ? String(branchId) : null;
  const includeOrderDocs = asBool(includeOrders, false);
  const filters = await buildBranchFilters(branchKey);
  const [stockIns, dailies, expenses] = await Promise.all([
    StockIn.find({ ...(branchKey ? filters.stock : {}), purchaseDate: { $gte: startIncl, $lte: endIncl }, 'posting.status': 'FAILED' }).select('_id purchaseDate posting branchId quantityKg amountPaid paidAmount supplier').lean(),
    DailySummary.find({ ...(branchKey ? filters.daily : {}), date: { $gte: startIncl, $lte: endIncl }, 'posting.status': 'FAILED' }).select('_id dailySummaryId date posting branchId cashierName sales').lean(),
    ExpenseTransaction.find({ ...(branchKey ? filters.expense : {}), date: { $gte: startIncl, $lte: endIncl }, 'posting.status': 'FAILED' }).select('_id date posting branchId category description amount').lean(),
  ]);
  const orders = includeOrderDocs
    ? await Order.find({ ...(branchKey ? filters.order : {}), createdAt: { $gte: startIncl, $lte: endIncl }, 'posting.status': 'FAILED' }).select('_id createdAt orderDate posting branchId serviceZoneId totalAmount').lean()
    : [];
  const reasons = {};
  const items = [];
  const recommendationFor = (code, doc = {}) => {
    const k = keyOfReason(code);
    if (k === 'DAILY_TENDER_MISMATCH') {
      const revenue = safeNum(doc?.sales?.totalRevenue, 0);
      const tenderTotal = safeNum(doc?.sales?.cashAmount, 0) + safeNum(doc?.sales?.posAmount, 0) + safeNum(doc?.sales?.transferAmount, 0);
      const diff = revenue - tenderTotal;
      if (Math.abs(diff) <= 500) return 'Small tender difference detected. The posting handler now sends differences up to ₦500 to Cash Over/Short. Click Retry Failed after applying this backend patch.';
      return 'Review the Daily Sales CSV/source close. If the difference is valid, approve the discrepancy to warehouse it in Cash Over/Short, then Retry Failed. If not valid, correct Expected Revenue or the Cash/POS/Transfer split before retrying.';
    }
    if (k.includes('ACCOUNT') || k.includes('COA')) return 'Run GL Bootstrap, confirm the account mapping exists, then Retry Failed.';
    if (k.includes('WAC') || k.includes('STOCK')) return 'Confirm opening stock/stock-in exists before this business date and branch stock config is active, then Retry Failed.';
    if (k.includes('PERIOD_LOCKED')) return 'Reopen the accounting period, retry posting, then lock the period again after review.';
    return 'Open the source record, correct the data/setup issue shown in the message, then use Retry Failed for the selected period.';
  };
  const pushOne = (sourceType, doc, businessDate) => {
    const code = keyOfReason(doc?.posting?.errorCode || 'FAILED');
    const item = {
      sourceType,
      sourceId: String(doc._id),
      branchKey: toBranchKey(doc),
      businessDate: businessDate ? new Date(businessDate).toISOString().slice(0, 10) : null,
      reasonCode: code,
      message: doc?.posting?.errorMessage || null,
      attempts: safeNum(doc?.posting?.attempts, 0),
      recommendation: recommendationFor(code, doc),
      amount: safeNum(doc?.sales?.totalRevenue ?? doc?.amount ?? doc?.totalAmount ?? doc?.amountPaid ?? doc?.paidAmount, 0),
      kg: safeNum(doc?.sales?.totalKgSold ?? doc?.quantityKg, 0),
      meta: sourceType === 'DAILY_SUMMARY' ? {
        dailySummaryId: doc.dailySummaryId || null,
        cashierName: doc.cashierName || null,
        revenue: safeNum(doc?.sales?.totalRevenue, 0),
        cash: safeNum(doc?.sales?.cashAmount, 0),
        pos: safeNum(doc?.sales?.posAmount, 0),
        transfer: safeNum(doc?.sales?.transferAmount, 0),
        tenderTotal: safeNum(doc?.sales?.cashAmount, 0) + safeNum(doc?.sales?.posAmount, 0) + safeNum(doc?.sales?.transferAmount, 0),
        difference: safeNum(doc?.sales?.totalRevenue, 0) - (safeNum(doc?.sales?.cashAmount, 0) + safeNum(doc?.sales?.posAmount, 0) + safeNum(doc?.sales?.transferAmount, 0)),
      } : {},
    };
    items.push(item);
    if (!reasons[code]) reasons[code] = { count: 0, examples: [], recommendation: recommendationFor(code, doc) };
    reasons[code].count += 1;
    if (reasons[code].examples.length < 10) reasons[code].examples.push(item);
  };
  (stockIns || []).forEach((x) => pushOne('STOCK_IN', x, x.purchaseDate));
  (dailies || []).forEach((x) => pushOne('DAILY_SUMMARY', x, x.date));
  if (includeOrderDocs) (orders || []).forEach((x) => pushOne('ORDER', x, x.orderDate || x.createdAt));
  (expenses || []).forEach((x) => pushOne('EXPENSE', x, x.date));
  return { ok: true, start: startIncl.toISOString(), end: endIncl.toISOString(), branchId: branchKey, includeOrders: includeOrderDocs, orderPostingPolicy: includeOrderDocs ? 'INCLUDED_BY_REQUEST' : 'EXCLUDED_BY_DEFAULT', totals: { failed: stockIns.length + dailies.length + (includeOrderDocs ? orders.length : 0) + expenses.length, ordersExcludedByPolicy: includeOrderDocs ? 0 : null }, reasons, items };
};

const listPostingBatches = async ({ startDate, endDate, branchId = null, action = null, page = 1, limit = 50 } = {}) => {
  const query = {};
  if (startDate || endDate) query.createdAt = {};
  if (startDate) query.createdAt.$gte = startOfDay(startDate);
  if (endDate) query.createdAt.$lte = endOfDay(endDate);
  if (branchId) query.branchKey = String(branchId);
  if (action) query.action = String(action).toUpperCase();
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safePage = Math.max(Number(page) || 1, 1);
  const [items, total] = await Promise.all([
    PostingBatch.find(query).sort({ createdAt: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).lean(),
    PostingBatch.countDocuments(query),
  ]);
  return { ok: true, page: safePage, limit: safeLimit, total, items };
};

module.exports = { bootstrap, rebuild, postApproved, retryFailed, trialBalance, postingExceptions, postReversal, listPostingBatches, assertPeriodOpenForDate, assertPeriodOpenForRange };
