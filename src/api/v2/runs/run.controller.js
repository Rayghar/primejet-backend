// File: src/api/v2/runs/run.controller.js
const runService = require('./run.service');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');

const parsePositiveInt = (value, fallback) => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

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
    const { page = 1, limit = 50, zoneId } = req.query;
    const result = await runService.getUnassignedOrders({
      page: parsePositiveInt(page, 1),
      limit: parsePositiveInt(limit, 50),
      zoneId,
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
    res.status(201).json(newRun);
  } catch (error) {
    logger.error('Error creating run from batch:', error);
    next(error);
  }
};

// Assigns a driver to a run and optimizes route from driver current location where available.
const assignDriverToRun = async (req, res, next) => {
  try {
    const { runId } = req.params;
    const { driverId, vanId, capacityKg } = req.body;
    if (!driverId) throw new HttpError(400, 'driverId is required.');

    const updatedRun = await runService.assignDriverToRun(runId, driverId, req.user.id, {
      vanId,
      capacityKg,
    });

    res.status(200).json({
      message: `Driver ${driverId} assigned to run ${runId}.`,
      run: updatedRun,
    });
  } catch (error) {
    logger.error('Error assigning driver:', error);
    next(error);
  }
};

// Fetches assigned runs for logged-in driver.
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
    const acceptedRun = await runService.driverAcceptRun(req.user.id, runId);
    res.status(200).json(acceptedRun);
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
    if (!status) throw new HttpError(400, 'status is required.');

    const result = await runService.driverUpdateStopStatus(req.user.id, runId, stopId, status, notes);
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
    const result = await runService.endRun(runId, req.user.id);
    res.status(200).json(result);
  } catch (error) {
    logger.error('Error ending run:', error);
    next(error);
  }
};

// Fetches a driver's run history.
const getRunHistory = async (req, res, next) => {
  try {
    const requestedDriverId = req.params.driverId || req.user.id;

    if (req.user.role === 'driver' && requestedDriverId !== req.user.id) {
      throw new HttpError(403, 'Drivers can only view their own run history.');
    }

    const { page = 1, limit = 15 } = req.query;
    const history = await runService.getRunHistory(requestedDriverId, {
      page: parsePositiveInt(page, 1),
      limit: parsePositiveInt(limit, 15),
    });
    res.status(200).json(history);
  } catch (error) {
    logger.error('Error fetching run history:', error);
    next(error);
  }
};

// Dispatch control dashboard.
const getDispatchDashboard = async (req, res, next) => {
  try {
    const dashboard = await runService.getDispatchControlDashboard();
    res.status(200).json(dashboard);
  } catch (error) {
    logger.error('Error fetching dispatch dashboard:', error);
    next(error);
  }
};

// Driver scorecards.
const getDriverScorecards = async (req, res, next) => {
  try {
    const scorecards = await runService.getDriverPerformanceScorecards({
      period: req.query.period || 'monthly',
    });
    res.status(200).json(scorecards);
  } catch (error) {
    logger.error('Error fetching driver scorecards:', error);
    next(error);
  }
};

// Re-optimize a run route.
const optimizeRunRoute = async (req, res, next) => {
  try {
    const { runId } = req.params;
    const run = await runService.optimizeRunRoute(runId, req.body || {});
    res.status(200).json({
      message: 'Run route optimized successfully.',
      run,
    });
  } catch (error) {
    logger.error('Error optimizing route:', error);
    next(error);
  }
};

// Review or override run capacity.
const updateRunCapacity = async (req, res, next) => {
  try {
    const { runId } = req.params;
    const run = await runService.updateRunCapacity(runId, req.body || {}, req.user.id);
    res.status(200).json({
      message: 'Run capacity reviewed successfully.',
      run,
    });
  } catch (error) {
    logger.error('Error updating run capacity:', error);
    next(error);
  }
};

// Failed delivery reason tracking.
const recordFailedDeliveryReason = async (req, res, next) => {
  try {
    const { runId, stopId } = req.params;
    const run = await runService.recordFailedDeliveryReason(runId, stopId, req.body || {}, req.user);
    res.status(200).json({
      message: 'Failed delivery reason recorded successfully.',
      run,
    });
  } catch (error) {
    logger.error('Error recording failed delivery reason:', error);
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
  getDispatchDashboard,
  getDriverScorecards,
  optimizeRunRoute,
  updateRunCapacity,
  recordFailedDeliveryReason,
};
