// src/api/v2/runs/run.service.js

// Import all necessary user service functions from the v1 service file
const {
  getPendingBatches,
  getActiveRuns,
  getUnassignedOrders,
  getRun,
  getAssignedRuns,
  acceptRun,
  driverUpdateStopStatus,
  createRunFromBatch,
  assignDriverToRun,
  endRun,
  getRunHistory
} = require('../../v1/runs/run.service');

// Re-export all functions that are needed for the v2 API.
// This makes them accessible to v2 controllers while keeping the implementation in v1.
module.exports = {
  getPendingBatches,
  getActiveRuns,
  getUnassignedOrders,
  getRun,
  getAssignedRuns,
  acceptRun,
  driverUpdateStopStatus,
  createRunFromBatch,
  assignDriverToRun,
  endRun,
  getRunHistory
};