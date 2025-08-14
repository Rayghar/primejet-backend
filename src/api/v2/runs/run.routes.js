// src/api/v2/runs/run.routes.js
const express = require('express');
const runController = require('./run.controller');
const authMiddleware = require('../../../middleware/auth.middleware');
const validate = require('../../../middleware/validate.middleware');
const {
  reassignDriverSchema,
  paginationSchema,
  updateStopStatusSchema,
  runIdParamSchema // Assuming a runIdParamSchema exists
} = require('./run.validation');
const runOrchestrationController = require('../run_orchestration/run_orchestration.controller');

const router = express.Router();

// --- Admin Routes ---
// These routes were previously returning 404 and are now correctly defined.
router.get('/admin/pending-batches', authMiddleware('admin'), runController.getPendingBatches);
router.get('/admin/active', authMiddleware('admin'), runController.getActiveRuns);
router.get('/admin/unassigned-orders', authMiddleware('admin'), validate(paginationSchema, 'query'), runController.getUnassignedOrders);
router.post('/admin/create-batch', authMiddleware('admin'), runOrchestrationController.adminCreateRunFromOrders);
router.put('/:runId/assign-driver', authMiddleware('admin'), validate(runIdParamSchema, 'params'), validate(reassignDriverSchema), runController.assignDriverToRun);

// Route to get specific run details (for admin/manager/assigned driver)
router.get('/:runId', authMiddleware(), validate(runIdParamSchema, 'params'), runController.getRun);

// --- Driver Routes ---
router.get('/driver/assigned-runs', authMiddleware('driver'), runController.getAssignedRuns);
router.post('/driver/runs/:runId/accept', authMiddleware('driver'), validate(runIdParamSchema, 'params'), runController.acceptRun);
router.post('/driver/runs/:runId/end', authMiddleware('driver'), validate(runIdParamSchema, 'params'), runController.endRun);
router.post('/driver/runs/:runId/stops/:stopId/update-status', authMiddleware('driver'), validate(runIdParamSchema, 'params'), validate(updateStopStatusSchema), runController.driverUpdateStopStatus);

// Route to get a driver's run history
router.get('/driver/:driverId/history', authMiddleware(['admin', 'manager', 'driver']), validate(runIdParamSchema, 'params'), validate(paginationSchema, 'query'), runController.getRunHistory);


module.exports = router;