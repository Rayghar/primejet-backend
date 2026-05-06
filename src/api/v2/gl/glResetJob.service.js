const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');

const GeneralLedgerEntry = require('../../../models/generalLedgerEntry.model');
const DailySummary = require('../../../models/dailySummary.model');
const ExpenseTransaction = require('../../../models/expenseTransaction.model');
const StockIn = require('../../../models/stockIn.model');
const Order = require('../../../models/order.model');
const SaleTransaction = require('../../../models/saleTransaction.model');
const PostingBatch = require('../../../models/postingBatch.model');
const GLReversalRequest = require('../../../models/glReversalRequest.model');
const AccountingPeriod = require('../../../models/accountingPeriod.model');
const Plant = require('../../../models/plant.model');

const jobs = new Map();
const MAX_JOBS = 50;

const asBool = (v) => v === true || String(v).toLowerCase() === 'true';
const hasVal = (v) => v !== undefined && v !== null && String(v).trim() !== '';

const parseBusinessDate = (d) => {
  if (!d) return null;
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const [y, m, day] = d.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, day, 0, 0, 0, 0));
  }
  const x = new Date(d);
  return x && !Number.isNaN(x.getTime()) ? x : null;
};

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

const buildGlRangeFilter = ({ startIncl, endIncl, branchFilter = {}, includePeriodKeyFallback = true } = {}) => {
  const startKey = periodKeyOf(startIncl);
  const endKey = periodKeyOf(endIncl);
  const ors = [{ date: { $gte: startIncl, $lte: endIncl } }];
  // Historical GL entries created by earlier builds may occasionally have inconsistent date typing
  // or only a periodKey. Keep this periodKey fallback for controlled reset/reconciliation ranges.
  if (includePeriodKeyFallback) ors.push({ periodKey: { $gte: startKey, $lte: endKey } });
  return { ...(branchFilter || {}), $or: ors };
};

const buildSourcePostedFilter = (baseFilter = {}) => ({
  ...baseFilter,
  $or: [
    { 'posting.status': { $in: ['POSTED', 'FAILED', 'PROCESSING'] } },
    // Do not use $nin: [null, '', undefined] on ObjectId paths.
    // Some legacy records contain an empty-string posting.glEntryId, and Mongoose
    // attempts to cast that empty string to ObjectId during count/update queries.
    // Checking for existence + non-null safely detects real ObjectId references
    // without throwing CastError on legacy empty strings. The reset patch still
    // normalizes all in-range source records to posting.glEntryId = null.
    { 'posting.glEntryId': { $exists: true, $ne: null } },
    { 'posting.glEntryIds.0': { $exists: true } },
  ],
});

const assertPeriodOpenForRange = async (start, end, action = 'reset GL') => {
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
  } catch (_) { plant = null; }
  if (plant) {
    addOid(plant._id);
    addString(plant._id);
    addString(plant.id);
    addString(plant.name);
  }
  return { strings: [...stringSet], objectIds: [...oidSet.values()], plant };
};

const buildBranchFilters = async (branchKey) => {
  if (!hasVal(branchKey)) return { stock: {}, daily: {}, expense: {}, order: {}, gl: {}, batch: {}, saleTx: {}, displayKey: null };
  const c = await resolveBranchCandidates(branchKey);
  const strings = c.strings || [];
  const objectIds = c.objectIds || [];
  const stringIn = strings.length ? { $in: strings } : null;
  const oidIn = objectIds.length ? { $in: objectIds } : null;

  const daily = oidIn ? { branchId: oidIn } : { _id: { $exists: false } };
  const saleTx = oidIn ? { branchId: oidIn } : { _id: { $exists: false } };
  const stock = stringIn ? { branchId: stringIn } : { _id: { $exists: false } };
  const expense = stringIn ? { branchId: stringIn } : { _id: { $exists: false } };
  const orderOr = [];
  if (oidIn) orderOr.push({ branchId: oidIn });
  if (stringIn) orderOr.push({ serviceZoneId: stringIn }, { zoneId: stringIn }, { plantId: stringIn }, { branchKey: stringIn });
  const order = orderOr.length ? { $or: orderOr } : { _id: { $exists: false } };
  const gl = stringIn ? { branchKey: stringIn } : { _id: { $exists: false } };
  const batch = stringIn ? { branchKey: stringIn } : { _id: { $exists: false } };
  return { stock, daily, expense, order, gl, batch, saleTx, strings, objectIds, displayKey: c.plant?._id ? String(c.plant._id) : String(branchKey) };
};

const resetPostingPatch = (requestedBy) => ({
  $set: {
    'posting.status': 'UNPOSTED',
    'posting.glEntryId': null,
    'posting.glEntryIds': [],
    'posting.postedAt': null,
    'posting.postedBy': null,
    'posting.errorCode': null,
    'posting.errorMessage': null,
    'posting.version': 1,
    'posting.resetAt': new Date(),
    'posting.resetBy': requestedBy || 'system',
  },
});

const toPublicJob = (job) => {
  if (!job) return null;
  return {
    jobId: job.jobId,
    type: job.type,
    status: job.status,
    dryRun: job.dryRun,
    startDate: job.startDate,
    endDate: job.endDate,
    branchId: job.branchId || null,
    includeOrders: Boolean(job.includeOrders),
    orderResetPolicy: job.includeOrders ? 'INCLUDED_BY_REQUEST' : 'EXCLUDED_BY_DEFAULT',
    createdAt: job.createdAt,
    startedAt: job.startedAt || null,
    finishedAt: job.finishedAt || null,
    requestedBy: job.requestedBy || null,
    progress: job.progress || { total: 0, processedRows: 0, percent: 0, stage: 'QUEUED' },
    found: job.found || null,
    result: job.result || null,
    error: job.error || null,
    warning: job.warning || null,
  };
};

const pruneJobs = () => {
  const list = [...jobs.values()].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  while (list.length > MAX_JOBS) {
    const old = list.shift();
    if (old?.jobId) jobs.delete(old.jobId);
  }
};

const updateProgress = (job, payload = {}) => {
  const total = Number(payload.total ?? job.progress?.total ?? 0);
  const processedRows = Number(payload.processedRows ?? job.progress?.processedRows ?? 0);
  const percent = total > 0 ? Math.min(100, Math.max(0, Math.round((processedRows / total) * 100))) : (payload.stage === 'COMPLETED' ? 100 : 0);
  job.progress = {
    total,
    processedRows,
    percent,
    stage: payload.stage || job.progress?.stage || 'RUNNING',
    sourceType: payload.sourceType || null,
    message: payload.message || job.progress?.message || null,
    updatedAt: new Date().toISOString(),
  };
  if (payload.found) job.found = payload.found;
  if (payload.result) job.result = payload.result;
  if (payload.error) job.error = payload.error;
  jobs.set(job.jobId, job);
};

const countTargets = async ({ startIncl, endIncl, branchKey, includeOrders = false }) => {
  const filters = await buildBranchFilters(branchKey);
  const glFilter = buildGlRangeFilter({ startIncl, endIncl, branchFilter: branchKey ? filters.gl : {} });
  const dailyFilter = { date: { $gte: startIncl, $lte: endIncl }, ...(branchKey ? filters.daily : {}) };
  const expenseFilter = { date: { $gte: startIncl, $lte: endIncl }, ...(branchKey ? filters.expense : {}) };
  const stockFilter = { purchaseDate: { $gte: startIncl, $lte: endIncl }, ...(branchKey ? filters.stock : {}) };
  const orderFilter = { ...(branchKey ? filters.order : {}), $and: [
    { $or: [{ orderDate: { $gte: startIncl, $lte: endIncl } }, { orderDate: { $exists: false }, createdAt: { $gte: startIncl, $lte: endIncl } }] },
  ] };
  const saleTxFilter = { createdAt: { $gte: startIncl, $lte: endIncl }, ...(branchKey ? filters.saleTx : {}) };
  const batchFilter = { ...(branchKey ? filters.batch : {}), $or: [
    { businessDate: { $gte: startIncl, $lte: endIncl } },
    { startDate: { $lte: endIncl }, endDate: { $gte: startIncl } },
    { createdAt: { $gte: startIncl, $lte: endIncl } },
  ] };

  const [glEntries, dailies, expenses, stockIns, orders, saleTx, postingBatches] = await Promise.all([
    GeneralLedgerEntry.countDocuments(glFilter),
    DailySummary.countDocuments(dailyFilter),
    ExpenseTransaction.countDocuments(expenseFilter),
    StockIn.countDocuments(stockFilter),
    includeOrders ? Order.countDocuments(orderFilter) : Promise.resolve(0),
    SaleTransaction.countDocuments(saleTxFilter),
    PostingBatch.countDocuments(batchFilter),
  ]);
  return { filters, glFilter, dailyFilter, expenseFilter, stockFilter, orderFilter, saleTxFilter, batchFilter, found: { glEntries, dailies, expenses, stockIns, orders: includeOrders ? orders : 0, ordersExcludedByPolicy: includeOrders ? 0 : null, saleTransactions: saleTx, postingBatches } };
};


const verifyResetState = async ({ startIncl, endIncl, branchKey, includeOrders = false } = {}) => {
  const targets = await countTargets({ startIncl, endIncl, branchKey, includeOrders });
  const filters = targets.filters;
  const postedDailyFilter = buildSourcePostedFilter(targets.dailyFilter);
  const postedExpenseFilter = buildSourcePostedFilter(targets.expenseFilter);
  const postedStockFilter = buildSourcePostedFilter(targets.stockFilter);
  const postedSaleTxFilter = buildSourcePostedFilter(targets.saleTxFilter);
  const postedOrderFilter = includeOrders ? buildSourcePostedFilter(targets.orderFilter) : { _id: { $exists: false } };

  const [remainingGlEntries, remainingPostingBatches, staleDailies, staleExpenses, staleStockIns, staleOrders, staleSaleTransactions, reversalRequests, sampleGl] = await Promise.all([
    GeneralLedgerEntry.countDocuments(targets.glFilter),
    PostingBatch.countDocuments(targets.batchFilter),
    DailySummary.countDocuments(postedDailyFilter),
    ExpenseTransaction.countDocuments(postedExpenseFilter),
    StockIn.countDocuments(postedStockFilter),
    includeOrders ? Order.countDocuments(postedOrderFilter) : Promise.resolve(0),
    SaleTransaction.countDocuments(postedSaleTxFilter),
    GLReversalRequest.countDocuments({ createdAt: { $gte: startIncl, $lte: endIncl } }),
    GeneralLedgerEntry.find(targets.glFilter).select('_id date periodKey sourceType sourceId branchKey status totals createdAt').sort({ date: -1, createdAt: -1 }).limit(10).lean(),
  ]);

  const staleSourceCount = staleDailies + staleExpenses + staleStockIns + staleOrders + staleSaleTransactions;
  return {
    ok: remainingGlEntries === 0 && remainingPostingBatches === 0 && staleSourceCount === 0,
    remainingGlEntries,
    remainingPostingBatches,
    stalePostingSources: {
      dailies: staleDailies,
      expenses: staleExpenses,
      stockIns: staleStockIns,
      orders: includeOrders ? staleOrders : 0,
      saleTransactions: staleSaleTransactions,
    },
    reversalRequestsCreatedInRange: reversalRequests,
    sampleGlEntries: sampleGl.map((j) => ({
      id: String(j._id),
      date: j.date,
      periodKey: j.periodKey,
      branchKey: j.branchKey,
      sourceType: j.sourceType,
      sourceId: j.sourceId,
      status: j.status,
      debit: j.totals?.debit || 0,
      credit: j.totals?.credit || 0,
      createdAt: j.createdAt,
    })),
  };
};

const runReset = async ({ startDate, endDate, branchId = null, dryRun = true, requestedBy = 'system', onProgress = null, includeOrders = false } = {}) => {
  const start = parseBusinessDate(startDate);
  const end = parseBusinessDate(endDate);
  if (!start || !end) { const e = new Error('Invalid startDate/endDate'); e.code = 'BAD_DATES'; throw e; }
  const startIncl = startOfDay(start);
  const endIncl = endOfDay(end);
  const branchKey = hasVal(branchId) ? String(branchId) : null;
  const includeOrderDocs = asBool(includeOrders);
  const emit = async (payload) => { if (typeof onProgress === 'function') { try { await onProgress(payload); } catch (_) {} } };
  await emit({ stage: 'VALIDATING_PERIOD', total: 0, processedRows: 0, message: 'Checking selected period before GL reset.' });
  if (!dryRun) await assertPeriodOpenForRange(startIncl, endIncl, 'reset GL');

  await emit({ stage: 'COUNTING_TARGETS', total: 0, processedRows: 0, message: 'Counting GL entries and source records to reset.' });
  const targets = await countTargets({ startIncl, endIncl, branchKey, includeOrders: includeOrderDocs });
  const totalRows = Object.values(targets.found).reduce((a, b) => a + Number(b || 0), 0);
  await emit({ stage: 'TARGETS_COUNTED', total: totalRows, processedRows: 0, found: targets.found, message: `Found ${totalRows} record(s) affected by the selected reset range.` });

  const result = { ok: true, dryRun: Boolean(dryRun), start: startIncl.toISOString(), end: endIncl.toISOString(), branchId: branchKey, found: targets.found, deleted: {}, reset: {} };
  if (dryRun) {
    await emit({ stage: 'COMPLETED', total: totalRows, processedRows: totalRows, found: targets.found, result, message: 'GL reset dry run completed. No database changes were made.' });
    return result;
  }

  let processed = 0;
  const step = async (stage, sourceType, count, fn, message) => {
    await emit({ stage, sourceType, total: totalRows, processedRows: processed, found: targets.found, message });
    const r = await fn();
    processed += Number(count || 0);
    await emit({ stage: `${stage}_DONE`, sourceType, total: totalRows, processedRows: processed, found: targets.found, message: `${message} Done.` });
    return r;
  };

  const journalIdsToDelete = await GeneralLedgerEntry.find(targets.glFilter).select('_id').lean();
  const journalObjectIds = journalIdsToDelete.map((j) => j._id).filter(Boolean);

  const deletedGl = await step('DELETING_GL_ENTRIES', 'GENERAL_LEDGER', targets.found.glEntries, () => GeneralLedgerEntry.deleteMany(targets.glFilter), 'Deleting GL entries in the selected range.');
  result.deleted.glEntries = deletedGl.deletedCount || 0;

  const deletedReversalRequests = await step('DELETING_STALE_REVERSAL_REQUESTS', 'GL_REVERSAL_REQUEST', journalObjectIds.length, () => (
    journalObjectIds.length ? GLReversalRequest.deleteMany({ journalId: { $in: journalObjectIds } }) : Promise.resolve({ deletedCount: 0 })
  ), 'Deleting reversal requests linked to cleared journals.');
  result.deleted.reversalRequests = deletedReversalRequests.deletedCount || 0;

  const deletedBatches = await step('DELETING_POSTING_BATCHES', 'POSTING_BATCH', targets.found.postingBatches, () => PostingBatch.deleteMany(targets.batchFilter), 'Deleting posting batch history for the selected range.');
  result.deleted.postingBatches = deletedBatches.deletedCount || 0;

  const patch = resetPostingPatch(requestedBy);
  const resetDailies = await step('RESETTING_DAILY_SUMMARIES', 'DAILY_SUMMARY', targets.found.dailies, () => DailySummary.updateMany(targets.dailyFilter, patch), 'Resetting DailySummary posting status to UNPOSTED.');
  result.reset.dailies = resetDailies.modifiedCount ?? resetDailies.nModified ?? 0;

  const resetExpenses = await step('RESETTING_EXPENSES', 'EXPENSE', targets.found.expenses, () => ExpenseTransaction.updateMany(targets.expenseFilter, patch), 'Resetting ExpenseTransaction posting status to UNPOSTED.');
  result.reset.expenses = resetExpenses.modifiedCount ?? resetExpenses.nModified ?? 0;

  const resetStockIns = await step('RESETTING_STOCK_INS', 'STOCK_IN', targets.found.stockIns, () => StockIn.updateMany(targets.stockFilter, patch), 'Resetting StockIn posting status to UNPOSTED.');
  result.reset.stockIns = resetStockIns.modifiedCount ?? resetStockIns.nModified ?? 0;

  if (includeOrderDocs) {
    const resetOrders = await step('RESETTING_ORDERS', 'ORDER', targets.found.orders, () => Order.updateMany(targets.orderFilter, patch), 'Resetting Order posting status to UNPOSTED for selected range.');
    result.reset.orders = resetOrders.modifiedCount ?? resetOrders.nModified ?? 0;
  } else {
    result.reset.orders = 0;
    result.reset.ordersExcludedByPolicy = true;
  }

  const resetSaleTx = await step('RESETTING_SALE_TRANSACTIONS', 'SALE_TX', targets.found.saleTransactions, () => SaleTransaction.updateMany(targets.saleTxFilter, patch), 'Resetting linked SaleTransaction posting status to UNPOSTED.');
  result.reset.saleTransactions = resetSaleTx.modifiedCount ?? resetSaleTx.nModified ?? 0;

  await emit({ stage: 'VERIFYING_RESET', total: totalRows, processedRows: totalRows, found: targets.found, message: 'Verifying that GL entries were deleted and source posting flags were reset.' });
  result.verification = await verifyResetState({ startIncl, endIncl, branchKey, includeOrders: includeOrderDocs });
  result.ok = Boolean(result.verification?.ok);
  const completionMessage = result.ok
    ? 'GL reset completed and verified. You can now run GL Rebuild Dry Run, then GL Rebuild Actual.'
    : 'GL reset completed, but verification found remaining GL entries or posted source flags. Review verification details before rebuild.';
  await emit({ stage: result.ok ? 'COMPLETED' : 'COMPLETED_WITH_WARNINGS', total: totalRows, processedRows: totalRows, found: targets.found, result, message: completionMessage });
  return result;
};

const startGlResetJob = ({ startDate, endDate, branchId, branchIdOrZoneId, dryRun = true, includeOrders = false } = {}, user = {}) => {
  const branch = branchId || branchIdOrZoneId || null;
  const jobId = `GLX-${Date.now()}-${uuidv4().slice(0, 8)}`;
  const job = {
    jobId,
    type: 'GL_RESET',
    status: 'QUEUED',
    dryRun: asBool(dryRun),
    startDate,
    endDate,
    branchId: branch,
    includeOrders: asBool(includeOrders),
    createdAt: new Date().toISOString(),
    requestedBy: user?.email || user?.name || user?.id || user?._id || 'system',
    progress: { total: 0, processedRows: 0, percent: 0, stage: 'QUEUED', message: `Queued for GL reset. Orders=${asBool(includeOrders) ? 'INCLUDED' : 'EXCLUDED'}.`, updatedAt: new Date().toISOString() },
    warning: 'Temporary in-memory GL reset job status. If the server restarts, visible job status may be lost, but completed database changes remain.',
  };
  jobs.set(jobId, job);
  pruneJobs();

  setImmediate(async () => {
    const live = jobs.get(jobId);
    if (!live) return;
    live.status = 'RUNNING';
    live.startedAt = new Date().toISOString();
    updateProgress(live, { stage: 'STARTED', total: 0, processedRows: 0, message: 'GL reset job started.' });
    try {
      const result = await runReset({
        startDate,
        endDate,
        branchId: branch,
        dryRun: live.dryRun,
        requestedBy: live.requestedBy,
        includeOrders: live.includeOrders,
        onProgress: async (progress) => {
          const j = jobs.get(jobId);
          if (!j) return;
          updateProgress(j, progress);
        },
      });
      const done = jobs.get(jobId);
      if (!done) return;
      done.status = 'COMPLETED';
      done.finishedAt = new Date().toISOString();
      done.result = result;
      done.found = result?.found || done.found;
      const total = done.progress?.total || Object.values(result?.found || {}).reduce((sum, n) => sum + Number(n || 0), 0);
      updateProgress(done, { stage: 'COMPLETED', total, processedRows: total, result, found: done.found, message: 'GL reset completed.' });
    } catch (err) {
      const failed = jobs.get(jobId);
      if (!failed) return;
      failed.status = 'FAILED';
      failed.finishedAt = new Date().toISOString();
      failed.error = err?.message || 'GL reset failed';
      updateProgress(failed, { stage: 'FAILED', total: failed.progress?.total || 0, processedRows: failed.progress?.processedRows || 0, error: failed.error, message: failed.error });
    }
  });
  return toPublicJob(job);
};

const getGlResetJob = (jobId) => toPublicJob(jobs.get(jobId));
const listGlResetJobs = () => [...jobs.values()].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 20).map(toPublicJob);

module.exports = { startGlResetJob, getGlResetJob, listGlResetJobs, runReset, verifyResetState, startOfDay, endOfDay };
