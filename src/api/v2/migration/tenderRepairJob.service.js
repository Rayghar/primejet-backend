const { v4: uuidv4 } = require('uuid');
const migrationService = require('./historicalMigration.service');

const jobs = new Map();
const MAX_JOBS = 50;

const toPublicJob = (job) => {
  if (!job) return null;
  return {
    jobId: job.jobId,
    type: job.type,
    status: job.status,
    dryRun: job.dryRun,
    startDate: job.startDate,
    endDate: job.endDate,
    branchCode: job.branchCode || null,
    createdAt: job.createdAt,
    startedAt: job.startedAt || null,
    finishedAt: job.finishedAt || null,
    requestedBy: job.requestedBy || null,
    progress: job.progress || { total: 0, processedRows: 0, percent: 0 },
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
  const total = Number(payload.total || 0);
  const processedRows = Number(payload.processedRows || 0);
  const percent = total > 0 ? Math.min(100, Math.round((processedRows / total) * 100)) : (payload.stage === 'COMPLETED' ? 100 : 0);
  job.progress = { total, processedRows, percent, stage: payload.stage || 'RUNNING', updatedAt: new Date().toISOString() };
  if (payload.result) job.result = payload.result;
  jobs.set(job.jobId, job);
};

const startTenderRepairJob = ({ startDate, endDate, branchCode, dryRun = true, chunkSize = 25 } = {}, user = {}) => {
  const jobId = `TR-${Date.now()}-${uuidv4().slice(0, 8)}`;
  const job = {
    jobId,
    type: 'TENDER_SPLIT_REPAIR',
    status: 'QUEUED',
    dryRun: !(dryRun === false || String(dryRun).toLowerCase() === 'false'),
    startDate,
    endDate,
    branchCode: branchCode || null,
    createdAt: new Date().toISOString(),
    requestedBy: user?.email || user?.name || user?.id || user?._id || 'system',
    progress: { total: 0, processedRows: 0, percent: 0, stage: 'QUEUED', updatedAt: new Date().toISOString() },
    result: null,
    error: null,
    warning: 'Temporary in-memory job status. If the server restarts, completed status may be lost, but database changes already committed will remain.',
  };
  jobs.set(jobId, job);
  pruneJobs();

  setImmediate(async () => {
    const liveJob = jobs.get(jobId);
    if (!liveJob) return;
    liveJob.status = 'RUNNING';
    liveJob.startedAt = new Date().toISOString();
    updateProgress(liveJob, { stage: 'STARTED', total: 0, processedRows: 0 });
    try {
      const result = await migrationService.repairTenderSplitsFromStagingProgress({
        startDate,
        endDate,
        branchCode,
        dryRun: liveJob.dryRun,
        chunkSize: Number(chunkSize) > 0 ? Number(chunkSize) : 25,
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
      updateProgress(done, { stage: 'COMPLETED', total: result.matchedRows || 0, processedRows: result.matchedRows || 0, result });
    } catch (err) {
      const failed = jobs.get(jobId);
      if (!failed) return;
      failed.status = 'FAILED';
      failed.finishedAt = new Date().toISOString();
      failed.error = err?.message || 'Tender repair job failed';
      failed.progress = { ...(failed.progress || {}), stage: 'FAILED', updatedAt: new Date().toISOString() };
      jobs.set(jobId, failed);
    }
  });

  return toPublicJob(job);
};

const getTenderRepairJob = (jobId) => toPublicJob(jobs.get(jobId));
const listTenderRepairJobs = () => [...jobs.values()].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 20).map(toPublicJob);

module.exports = { startTenderRepairJob, getTenderRepairJob, listTenderRepairJobs };
