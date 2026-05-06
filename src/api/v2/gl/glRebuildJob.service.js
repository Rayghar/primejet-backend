const { v4: uuidv4 } = require('uuid');
const posting = require('./posting.service');

const jobs = new Map();
const MAX_JOBS = 50;

const asBool = (v) => v === true || String(v).toLowerCase() === 'true';

const toPublicJob = (job) => {
  if (!job) return null;
  return {
    jobId: job.jobId,
    type: job.type,
    status: job.status,
    dryRun: job.dryRun,
    settlementMode: job.settlementMode || null,
    historicalStockFundingMode: job.historicalStockFundingMode || null,
    historicalCogsMode: job.historicalCogsMode || null,
    forceExpensePaymentAccount: job.forceExpensePaymentAccount || null,
    accountingPolicy: job.accountingPolicy || null,
    includeOrders: Boolean(job.includeOrders),
    orderPostingPolicy: job.includeOrders ? 'INCLUDED_BY_REQUEST' : 'EXCLUDED_BY_DEFAULT',
    startDate: job.startDate,
    endDate: job.endDate,
    branchId: job.branchId || null,
    createdAt: job.createdAt,
    startedAt: job.startedAt || null,
    finishedAt: job.finishedAt || null,
    requestedBy: job.requestedBy || null,
    progress: job.progress || { total: 0, processedRows: 0, percent: 0, stage: 'QUEUED' },
    found: job.found || null,
    stats: job.stats || null,
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
  const total = Number(payload.total || job.progress?.total || 0);
  const processedRows = Number(payload.processedRows || 0);
  const percent = total > 0 ? Math.min(100, Math.max(0, Math.round((processedRows / total) * 100))) : (payload.stage === 'COMPLETED' ? 100 : 0);
  job.progress = {
    total,
    processedRows,
    percent,
    stage: payload.stage || job.progress?.stage || 'RUNNING',
    sourceType: payload.sourceType || null,
    currentSourceId: payload.currentSourceId || null,
    message: payload.message || job.progress?.message || null,
    updatedAt: new Date().toISOString(),
  };
  if (payload.found) job.found = payload.found;
  if (payload.stats) job.stats = payload.stats;
  if (payload.result) job.result = payload.result;
  if (payload.error) job.error = payload.error;
  jobs.set(job.jobId, job);
};

const startGlRebuildJob = ({ startDate, endDate, branchId, branchIdOrZoneId, dryRun = true, settlementMode = 'SAME_DAY', historicalStockFundingMode = 'BANK', historicalCogsMode = 'STOCK_PURCHASE_FULL_COST', forceExpensePaymentAccount = 'BANK', accountingPolicy = 'OPTION_C_BANK_CENTRIC_WORKING_CAPITAL', includeOrders = false } = {}, user = {}) => {
  const branch = branchId || branchIdOrZoneId || null;
  const jobId = `GLR-${Date.now()}-${uuidv4().slice(0, 8)}`;
  const job = {
    jobId,
    type: 'GL_REBUILD',
    status: 'QUEUED',
    dryRun: asBool(dryRun),
    settlementMode,
    historicalStockFundingMode,
    historicalCogsMode,
    forceExpensePaymentAccount,
    accountingPolicy,
    includeOrders: asBool(includeOrders),
    startDate,
    endDate,
    branchId: branch,
    createdAt: new Date().toISOString(),
    requestedBy: user?.email || user?.name || user?.id || user?._id || 'system',
    progress: { total: 0, processedRows: 0, percent: 0, stage: 'QUEUED', message: `Queued for GL rebuild. Policy=${accountingPolicy}; settlement=${settlementMode}; stockFunding=${historicalStockFundingMode}; historicalCogs=${historicalCogsMode}; expensePayment=${forceExpensePaymentAccount || 'SOURCE'}; orders=${asBool(includeOrders) ? 'INCLUDED' : 'EXCLUDED'}.`, updatedAt: new Date().toISOString() },
    found: null,
    stats: null,
    result: null,
    error: null,
    warning: 'Temporary in-memory GL rebuild job status. If the server restarts, visible job status may be lost, but completed database changes remain.',
  };
  jobs.set(jobId, job);
  pruneJobs();

  setImmediate(async () => {
    const liveJob = jobs.get(jobId);
    if (!liveJob) return;
    liveJob.status = 'RUNNING';
    liveJob.startedAt = new Date().toISOString();
    updateProgress(liveJob, { stage: 'STARTED', total: 0, processedRows: 0, message: 'GL rebuild job started.' });
    try {
      const result = await posting.rebuild({
        startDate,
        endDate,
        branchId: branch,
        dryRun: liveJob.dryRun,
        postedBy: liveJob.requestedBy,
        settlementMode: liveJob.settlementMode,
        historicalStockFundingMode: liveJob.historicalStockFundingMode,
        historicalCogsMode: liveJob.historicalCogsMode,
        forceExpensePaymentAccount: liveJob.forceExpensePaymentAccount,
        accountingPolicy: liveJob.accountingPolicy,
        includeOrders: liveJob.includeOrders,
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
      done.stats = {
        posted: result?.posted || {},
        skipped: result?.skipped || {},
        failed: result?.failed || {},
        reasons: result?.reasons || {},
      };
      const total = done.progress?.total || Object.values(result?.found || {}).reduce((sum, n) => sum + Number(n || 0), 0);
      updateProgress(done, { stage: 'COMPLETED', total, processedRows: total, result, found: done.found, stats: done.stats, message: 'GL rebuild completed.' });
    } catch (err) {
      const failed = jobs.get(jobId);
      if (!failed) return;
      failed.status = 'FAILED';
      failed.finishedAt = new Date().toISOString();
      failed.error = err?.message || 'GL rebuild job failed';
      updateProgress(failed, { stage: 'FAILED', total: failed.progress?.total || 0, processedRows: failed.progress?.processedRows || 0, error: failed.error, message: failed.error });
    }
  });

  return toPublicJob(job);
};

const getGlRebuildJob = (jobId) => toPublicJob(jobs.get(jobId));
const listGlRebuildJobs = () => [...jobs.values()].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 20).map(toPublicJob);

module.exports = { startGlRebuildJob, getGlRebuildJob, listGlRebuildJobs };
