// File: src/api/v1/runs/run.routes.js
const express = require('express');
const runController = require('./run.controller');
const authMiddleware = require('../../../middleware/auth.middleware');
const validate = require('../../../middleware/validate.middleware');
const {
  reassignDriverSchema,
  paginationSchema,
  updateStopStatusSchema,
  createBatchRunSchema,
} = require('./run.validation');

const router = express.Router();

console.log('[RUN_ROUTES] Registering run/batch routes...');

// -----------------------------------------------------------------------------
// IMPORTANT ROUTE ORDER
// -----------------------------------------------------------------------------
// Specific /admin and /driver routes must come before generic /:runId routes.

// --- Admin Routes ---
router.get('/admin/pending-batches', authMiddleware('admin'), runController.getPendingBatches);
router.get('/admin/active', authMiddleware('admin'), runController.getActiveRuns);
router.get('/admin/unassigned-orders', authMiddleware('admin'), runController.getUnassignedOrders);
router.post('/admin/create-batch', authMiddleware('admin'), validate(createBatchRunSchema), runController.createRunFromBatch);

// --- Driver Routes ---
router.get('/driver/assigned-runs', authMiddleware('driver'), runController.getAssignedRuns);
router.get('/driver/history', authMiddleware('driver'), runController.getRunHistory);
router.put('/driver/runs/:runId/accept', authMiddleware('driver'), runController.driverAcceptRun);
router.post('/driver/runs/:runId/accept', authMiddleware('driver'), runController.driverAcceptRun);
router.post('/driver/runs/:runId/end', authMiddleware('driver'), runController.endRun);
router.post('/driver/runs/:runId/stops/:stopId/update-status', authMiddleware('driver'), validate(updateStopStatusSchema), runController.driverUpdateStopStatus);

// --- Generic Run Routes ---
router.put('/:runId/assign-driver', authMiddleware('admin'), validate(reassignDriverSchema), runController.assignDriverToRun);
router.post('/:runId/end', authMiddleware('driver'), runController.endRun);

// Keep last so /driver/... is never captured as runId.
router.get('/:runId', authMiddleware(), runController.getRun);

console.log('[RUN_ROUTES] Run/batch routes registered.');

module.exports = router;
