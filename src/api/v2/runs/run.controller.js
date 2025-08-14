// src/api/v2/runs/run.controller.js
const runService = require('./run.service');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');

// Fetches all pending batches.
const getPendingBatches = async (req, res, next) => {
  try {
    const batches = await runService.getPendingBatches();
    res.status(200).json(batches);
  } catch (error) {
    logger.error('Error in getPendingBatches:', error);
    next(error);
  }
};

// Fetches all active runs for admin/manager view.
const getActiveRuns = async (req, res, next) => {
  try {
    const runs = await runService.getActiveRuns();
    res.status(200).json(runs);
  } catch (error) {
    logger.error('Error in getActiveRuns:', error);
    next(error);
  }
};

// Fetches all unassigned orders for the run assignment board.
const getUnassignedOrders = async (req, res, next) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const result = await runService.getUnassignedOrders({
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
    res.status(200).json(result);
  } catch (error) {
    logger.error('Error in getUnassignedOrders:', error);
    next(error);
  }
};

// Fetches a specific run's details.
const getRun = async (req, res, next) => {
  try {
    const { runId } = req.params;
    const run = await runService.getRun(runId, req.user); 
    res.status(200).json(run);
  } catch (error) {
    logger.error(`Error fetching run ${req.params.runId}:`, error);
    next(error);
  }
};

// Creates a new run from a batch of orders.
const createRunFromBatch = async (req, res, next) => {
  try {
    const { orderIds } = req.body;
    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      throw new HttpError(400, 'An array of orderIds is required.');
    }
    const newRun = await runService.createRunFromBatch(orderIds, req.user.id);
    res.status(200).json(newRun);
  } catch (error) {
    logger.error('Error creating run from batch:', error);
    next(error);
  }
};

// Assigns a driver to a run.
const assignDriverToRun = async (req, res, next) => {
  try {
    const { runId } = req.params;
    const { driverId } = req.body;
    const updatedRun = await runService.assignDriverToRun(runId, driverId, req.user.id);
    res.status(200).json({ message: `Driver ${driverId} assigned to run ${runId}.`, run: updatedRun });
  } catch (error) {
    logger.error('Error assigning driver:', error);
    next(error);
  }
};

// Fetches assigned runs for a specific driver.
const getAssignedRuns = async (req, res, next) => {
  try {
    const runs = await runService.getAssignedRuns(req.user.id);
    res.status(200).json(runs);
  } catch (error) {
    logger.error('Error in getAssignedRuns:', error);
    next(error);
  }
};

// Accepts a run for a driver.
const acceptRun = async (req, res, next) => {
  try {
    const { runId } = req.params;
    const acceptedRun = await runService.acceptRun(runId, req.user.id);
    res.status(200).json({ message: `Run ${runId} accepted successfully.`, run: acceptedRun });
  } catch (error) {
    logger.error('Error in acceptRun:', error);
    next(error);
  }
};

// Updates a stop's status within a run.
const driverUpdateStopStatus = async (req, res, next) => {
  try {
    const { runId, stopId } = req.params;
    const { status, notes } = req.body;
    const result = await runService.driverUpdateStopStatus(runId, stopId, status, notes, req.user.id);
    res.status(200).json(result);
  } catch (error) {
    logger.error('Error updating stop status:', error);
    next(error);
  }
};

// Ends a run for a driver.
const endRun = async (req, res, next) => {
  try {
    const { runId } = req.params;
    const driverId = req.user.id;
    const result = await runService.endRun(runId, driverId);
    res.status(200).json(result);
  } catch (error) {
    logger.error('Error ending run:', error);
    next(error);
  }
};

// Fetches a driver's run history.
const getRunHistory = async (req, res, next) => {
  try {
    const { driverId } = req.params;
    const { page, limit } = req.query;
    const history = await runService.getRunHistory(driverId, { page, limit });
    res.status(200).json(history);
  } catch (error) {
    logger.error('Error fetching run history:', error);
    next(error);
  }
};

module.exports = {
  getPendingBatches,
  getActiveRuns,
  getUnassignedOrders,
  getRun,
  createRunFromBatch,
  assignDriverToRun,
  getAssignedRuns,
  acceptRun,
  driverUpdateStopStatus,
  endRun,
  getRunHistory,
};