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
const runOrchestrationController = require('../run_orchestration/run_orchestration.controller'); 

const router = express.Router();

console.log('[RUN_ROUTES] Registering run/batch routes...');

// --- Admin Routes ---
router.get(
  '/admin/pending-batches',
  authMiddleware('admin'),
  runController.getPendingBatches
);

router.get(
  '/admin/active',
  authMiddleware('admin'),
  runController.getActiveRuns
);

router.get(
  '/admin/unassigned-orders',
  authMiddleware('admin'),
  validate(paginationSchema, 'query'),
  runController.getUnassignedOrders
);

router.post(
  '/admin/create-batch',
  authMiddleware('admin'),
  validate(createBatchRunSchema), // <-- 2. Apply the validation middleware
  runController.createRunFromBatch 
);

router.put(
  '/driver/runs/:runId/accept',
  authMiddleware('driver'),
  runController.driverAcceptRun
);

router.get('/:runId', authMiddleware(), runController.getRun);

router.put(
  '/:runId/assign-driver',
  authMiddleware('admin'),
  validate(reassignDriverSchema),
  runController.assignDriverToRun
);

// --- Driver Routes ---
router.get(
  '/driver/assigned-runs',
  authMiddleware('driver'),
  runController.getAssignedRuns
);

// This is the correct route for updating stop status
router.post(
  '/driver/runs/:runId/stops/:stopId/update-status',
  authMiddleware('driver'),
  validate(updateStopStatusSchema),
  runController.driverUpdateStopStatus
);

// This route for fetching driver run history is now deduplicated
router.get(
  '/driver/history',
  authMiddleware('driver'),
  validate(paginationSchema, 'query'), 
  runController.getRunHistory
);

// ======================= FIX STARTS HERE =======================
// Add this new route to handle the "end run" action from the driver app.
// It should be a POST or PUT request since it changes the state of the run.
// Driver ends a run
router.post(
  '/:runId/end', // Use this simplified and consistent path
  authMiddleware('driver'),
  runController.endRun
);
// ======================== FIX ENDS HERE ========================

console.log('[RUN_ROUTES] Run/batch routes registered.');

module.exports = router;