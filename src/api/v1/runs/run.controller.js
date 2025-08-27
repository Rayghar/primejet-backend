// File: src/api/v1/runs/run.controller.js
const runService = require('./run.service');
const HttpError = require('../../../utils/HttpError');

const getPendingBatches = async (req, res, next) => {
  try {
    console.log('[RUN_CONTROLLER] Fetching pending batches');
    const batches = await runService.getPendingBatches();
    res.status(200).json(batches);
  } catch (error) {
    console.error('[RUN_CONTROLLER] Error in getPendingBatches:', error);
    next(error);
  }
};

const getActiveRuns = async (req, res, next) => {
  try {
    console.log('[RUN_CONTROLLER] Fetching active runs');
    const runs = await runService.getActiveRuns();
    res.status(200).json(runs);
  } catch (error) {
    console.error('[RUN_CONTROLLER] Error in getActiveRuns:', error);
    next(error);
  }
};

const getUnassignedOrders = async (req, res, next) => {
  try {
    console.log('[RUN_CONTROLLER] Fetching unassigned orders:', req.query);
    const { page = 1, limit = 10 } = req.query;
    const result = await runService.getUnassignedOrders({
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
    res.status(200).json(result);
  } catch (error) {
    console.error('[RUN_CONTROLLER] Error in getUnassignedOrders:', error);
    next(error);
  }
};

const getRun = async (req, res, next) => {
  try {
    const { runId } = req.params;
    console.log(`[RUN_CONTROLLER] Fetching run for runId: ${runId}, userId: ${req.user.id}, role: ${req.user.role}`);
    const run = await runService.getRun(runId, req.user);
    console.log(`[RUN_CONTROLLER] Returning run: ${run.id}`);
    res.status(200).json(run);
  } catch (error) {
    console.error(`[RUN_CONTROLLER] Error fetching run ${runId}:`, error);
    next(error);
  }
};

const createRunFromBatch = async (req, res, next) => {
  try {
    const { orderIds } = req.body;
    console.log('[RUN_CONTROLLER] Creating run from batch with orderIds:', orderIds);
    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      throw new HttpError(400, 'An array of orderIds is required.');
    }
    const newRun = await runService.createRunFromBatch(orderIds, req.user.id);
    res.status(200).json(newRun);
  } catch (error) {
    console.error('[RUN_CONTROLLER] Error creating run from batch:', error);
    next(error);
  }
};

const assignDriverToRun = async (req, res, next) => {
  try {
    const { runId } = req.params;
    const { driverId } = req.body;
    console.log(`[RUN_CONTROLLER] Assigning driver ${driverId} to run ${runId}`);
    const updatedRun = await runService.assignDriverToRun(runId, driverId, req.user.id);
    res.status(200).json({ message: `Driver ${driverId} assigned to run ${runId}.`, run: updatedRun });
  } catch (error) {
    console.error('[RUN_CONTROLLER] Error assigning driver:', error);
    next(error);
  }
};

const getAssignedRuns = async (req, res, next) => {
  try {
    console.log(`[RUN_CONTROLLER] Fetching assigned runs for driver ${req.user.id}`);
    const runs = await runService.getAssignedRuns(req.user.id);
    res.status(200).json(runs);
  } catch (error) {
    console.error('[RUN_CONTROLLER] Error in getAssignedRuns:', error);
    next(error);
  }
};

// Removed the buggy 'acceptRun' controller function

const driverUpdateStopStatus = async (req, res, next) => {
  try {
    const { runId, stopId } = req.params;
    const { status, notes } = req.body;
    console.log(`[RUN_CONTROLLER] Driver ${req.user.id} updating stop ${stopId} in run ${runId} to status ${status}`);
    const result = await runService.driverUpdateStopStatus(req.user.id, runId, stopId, status, notes);
    res.status(200).json(result);
  } catch (error) {
    console.error('[RUN_CONTROLLER] Error updating stop status:', error);
    next(error);
  }
};

// The new controller function for handling history requests.
const getRunHistory = async (req, res, next) => {
  try {
    const driverId = req.user.id;
    const { page = 1, limit = 15 } = req.query;
    console.log(`[RUN_CONTROLLER] Fetching run history for driver ${driverId}`);
    const history = await runService.getRunHistory(driverId, { page, limit });
    res.status(200).json(history);
  } catch (error) {
    console.error('[RUN_CONTROLLER] Error fetching run history:', error);
    next(error);
  }
};

const driverAcceptRun = async (req, res, next) => {
  try {
    const { runId } = req.params;
    console.log(`[RUN_CONTROLLER] Driver ${req.user.id} accepting run ${runId}`);
    const result = await runService.driverAcceptRun(req.user.id, runId);
    res.status(200).json(result);
  } catch (error) {
    console.error('[RUN_CONTROLLER] Error in driverAcceptRun:', error);
    next(error);
  }
};

const endRun = async (req, res, next) => {
    try {
        const { runId } = req.params;
        const driverId = req.user.id;
        console.log(`[RUN_CONTROLLER] Driver ${driverId} attempting to end run ${runId}`);
        const result = await runService.endRun(runId, driverId);
        res.status(200).json(result);
    } catch (error) {
        console.error('[RUN_CONTROLLER] Error ending run:', error);
        next(error);
    }
};

module.exports = {
  getPendingBatches,
  getActiveRuns,
  getUnassignedOrders,
  getRun,
  getAssignedRuns,
  createRunFromBatch,
  driverUpdateStopStatus,
  assignDriverToRun,
  endRun, 
  getRunHistory, 
  driverAcceptRun, 
};