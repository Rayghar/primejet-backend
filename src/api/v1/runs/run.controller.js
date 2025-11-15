// File: src/api/v1/runs/run.controller.js
const runService = require('./run.service');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config.js');

/**
 * Small wrapper to add consistent, low-noise structured logs around each handler
 * without changing handler internals.
 */
const withLogging = (name, handler) => {
  return async (req, res, next) => {
    const meta = {
      route: req.originalUrl,
      method: req.method,
      userId: req.user?.id || null,
      role: req.user?.role || null,
      requestId: req.id || req.headers['x-request-id'] || null,
    };
    logger.info(`[RUN_CONTROLLER] ${name}: start`, meta);
    try {
      await handler(req, res, next);
      logger.info(`[RUN_CONTROLLER] ${name}: success`, meta);
    } catch (error) {
      logger.error(`[RUN_CONTROLLER] ${name}: error`, {
        ...meta,
        message: error?.message,
        stack: error?.stack,
      });
      next(error);
    }
  };
};

// -------------------- Raw handlers (wrapped below) --------------------

const getPendingBatches = async (req, res, next) => {
  const batches = await runService.getPendingBatches();
  res.status(200).json(batches);
};

const getActiveRuns = async (req, res, next) => {
  const runs = await runService.getActiveRuns();
  res.status(200).json(runs);
};

const getUnassignedOrders = async (req, res, next) => {
  const { page = 1, limit = 10 } = req.query;
  const result = await runService.getUnassignedOrders({
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
  });
  res.status(200).json(result);
};

const getRun = async (req, res, next) => {
  const { runId } = req.params;
  const run = await runService.getRun(runId, req.user);
  res.status(200).json(run);
};

const createRunFromBatch = async (req, res, next) => {
  const { orderIds } = req.body;
  if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
    throw new HttpError(400, 'An array of orderIds is required.');
  }
  const newRun = await runService.createRunFromBatch(orderIds, req.user.id);
  res.status(201).json(newRun);
};

const assignDriverToRun = async (req, res, next) => {
  const { runId } = req.params;
  const { driverId } = req.body;
  if (!driverId) {
    throw new HttpError(400, 'driverId is required.');
  }
  const updatedRun = await runService.assignDriverToRun(runId, driverId, req.user.id);
  res.status(200).json({
    message: `Driver ${driverId} assigned to run ${runId}.`,
    run: updatedRun,
  });
};

const getAssignedRuns = async (req, res, next) => {
  const runs = await runService.getAssignedRuns(req.user.id);
  res.status(200).json(runs);
};

const driverUpdateStopStatus = async (req, res, next) => {
  const { runId, stopId } = req.params;
  const { status, notes } = req.body;
  if (!status) {
    throw new HttpError(400, 'status is required.');
  }
  const result = await runService.driverUpdateStopStatus(
    req.user.id,
    runId,
    stopId,
    status,
    notes
  );
  res.status(200).json(result);
};

const getRunHistory = async (req, res, next) => {
  const driverId = req.user.id;
  const { page = 1, limit = 15 } = req.query;
  const history = await runService.getRunHistory(driverId, {
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
  });
  res.status(200).json(history);
};

const driverAcceptRun = async (req, res, next) => {
  const { runId } = req.params;
  const result = await runService.driverAcceptRun(req.user.id, runId);
  res.status(200).json(result);
};

const endRun = async (req, res, next) => {
  const { runId } = req.params;
  const driverId = req.user.id;
  const result = await runService.endRun(runId, driverId);
  res.status(200).json(result);
};

// -------------------- Export wrapped handlers --------------------
module.exports = {
  getPendingBatches: withLogging('getPendingBatches', getPendingBatches),
  getActiveRuns: withLogging('getActiveRuns', getActiveRuns),
  getUnassignedOrders: withLogging('getUnassignedOrders', getUnassignedOrders),
  getRun: withLogging('getRun', getRun),
  getAssignedRuns: withLogging('getAssignedRuns', getAssignedRuns),
  createRunFromBatch: withLogging('createRunFromBatch', createRunFromBatch),
  driverUpdateStopStatus: withLogging('driverUpdateStopStatus', driverUpdateStopStatus),
  assignDriverToRun: withLogging('assignDriverToRun', assignDriverToRun),
  endRun: withLogging('endRun', endRun),
  getRunHistory: withLogging('getRunHistory', getRunHistory),
  driverAcceptRun: withLogging('driverAcceptRun', driverAcceptRun),
};
