// src/api/v1/runs/run.routes.js
const express = require('express');
const runController = require('./run.controller');
const authMiddleware = require('../../../middleware/auth.middleware');
const validate = require('../../../middleware/validate.middleware');
const {
  reassignDriverSchema,
  paginationSchema,
  updateStopStatusSchema,
} = require('./run.validation');
const runOrchestrationController = require('../run_orchestration/run_orchestration.controller'); // New import

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

// MODIFIED: This route now points to the new orchestration controller for batch creation
router.post(
  '/admin/create-batch',
  authMiddleware('admin'),
  // validate(createBatchRunSchema), // Validation now handled by orchestration controller
  runOrchestrationController.adminCreateRunFromOrders // Point to the new controller
);

// << NEW CODE TO ADD >>
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

/*router.post(
  '/driver/runs/:runId/accept',
  authMiddleware('driver'),
  runController.acceptRun
);*/

// <<< FIX: Added the missing route to handle ending a run >>>
router.post(
  '/driver/runs/:runId/end',
  authMiddleware('driver'),
  runController.endRun // This now correctly points to the existing controller function
);

router.post(
  '/driver/runs/:runId/stops/:stopId/update-status',
  authMiddleware('driver'),
  validate(updateStopStatusSchema),
  runController.driverUpdateStopStatus
);

// FIX: Add the new route for fetching driver run history
router.get(
  '/driver/history',
  authMiddleware('driver'),
  validate(paginationSchema, 'query'), // Ensure pagination parameters are validated
  runController.getRunHistory
);
router.get(
  '/driver/history',
  authMiddleware('driver'),
  runController.getRunHistory
);

console.log('[RUN_ROUTES] Run/batch routes registered.');

module.exports = router;