const service = require('./historicalMigration.service');
const tenderRepairJobs = require('./tenderRepairJob.service');
const HttpError = require('../../../utils/HttpError');

const getUser = (req) => ({ id: req.user?.id || req.user?._id || 'system', name: req.user?.name || req.user?.fullName || req.user?.email || 'System User' });

const getTemplate = async (req, res, next) => {
  try {
    res.status(200).json({ ok: true, template: service.TEMPLATE, rule: 'Use explicit business date columns. Upload date is audit-only and is never used as transaction date.' });
  } catch (error) { next(error); }
};

const createBatch = async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body.rows || typeof body.rows !== 'object') throw new HttpError(400, 'rows object is required.');
    const result = await service.createBatch({ ...body, user: getUser(req) });
    res.status(201).json({ ok: true, ...result });
  } catch (error) { next(error); }
};

const listBatches = async (req, res, next) => {
  try {
    const result = await service.listBatches(req.query || {});
    res.status(200).json({ ok: true, ...result });
  } catch (error) { next(error); }
};

const getBatch = async (req, res, next) => {
  try {
    const result = await service.getBatch(req.params.batchId, req.query || {});
    res.status(200).json({ ok: true, ...result });
  } catch (error) { next(error); }
};

const updateStagingRecord = async (req, res, next) => {
  try {
    const result = await service.updateStagingRecord(req.params.recordId, req.body || {});
    res.status(200).json({ ok: true, record: result });
  } catch (error) { next(error); }
};

const dryRun = async (req, res, next) => {
  try {
    const result = await service.dryRun(req.params.batchId);
    res.status(200).json({ ok: true, ...result });
  } catch (error) { next(error); }
};


const repairTenderSplits = async (req, res, next) => {
  try {
    const result = await service.repairTenderSplitsFromStaging({ ...(req.body || {}), ...(req.query || {}) });
    res.status(200).json({ ok: true, ...result });
  } catch (error) { next(error); }
};


const startTenderRepairJob = async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body.startDate || !body.endDate) throw new HttpError(400, 'startDate and endDate are required.');
    const job = tenderRepairJobs.startTenderRepairJob(body, req.user || {});
    res.status(202).json({ ok: true, job });
  } catch (error) { next(error); }
};

const getTenderRepairJob = async (req, res, next) => {
  try {
    const job = tenderRepairJobs.getTenderRepairJob(req.params.jobId);
    if (!job) throw new HttpError(404, 'Tender repair job not found. The server may have restarted or the job id is invalid.');
    res.status(200).json({ ok: true, job });
  } catch (error) { next(error); }
};

const listTenderRepairJobs = async (req, res, next) => {
  try {
    res.status(200).json({ ok: true, jobs: tenderRepairJobs.listTenderRepairJobs() });
  } catch (error) { next(error); }
};

const importBatch = async (req, res, next) => {
  try {
    const result = await service.importBatch(req.params.batchId, { ...(req.body || {}), user: getUser(req) });
    res.status(200).json({ ok: true, ...result });
  } catch (error) { next(error); }
};

module.exports = { getTemplate, createBatch, listBatches, getBatch, updateStagingRecord, dryRun, importBatch, repairTenderSplits, startTenderRepairJob, getTenderRepairJob, listTenderRepairJobs };
