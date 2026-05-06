// File: src/api/v2/runs/run.routes.js
const express = require('express');
const runController = require('./run.controller');
const authMiddleware = require('../../../middleware/auth.middleware');

const router = express.Router();

// -----------------------------------------------------------------------------
// IMPORTANT ROUTE ORDER
// -----------------------------------------------------------------------------
// Keep specific /admin and /driver routes above generic /:runId routes.
// Otherwise /driver/... can be incorrectly captured as runId.

// --- Admin / Manager Dispatch Routes ---
router.get('/admin/pending-batches', authMiddleware(['admin', 'manager']), runController.getPendingBatches);
router.get('/admin/active', authMiddleware(['admin', 'manager']), runController.getActiveRuns);
router.get('/admin/unassigned-orders', authMiddleware(['admin', 'manager']), runController.getUnassignedOrders);
router.post('/admin/create-batch', authMiddleware(['admin', 'manager']), runController.createRunFromBatch);

// --- Dispatch Control / Reporting Routes ---
router.get('/dispatch-dashboard', authMiddleware(['admin', 'manager']), runController.getDispatchDashboard);
router.get('/driver-scorecards', authMiddleware(['admin', 'manager']), runController.getDriverScorecards);

// --- Driver Routes ---
router.get('/driver/assigned-runs', authMiddleware('driver'), runController.getAssignedRuns);
router.get('/driver/history', authMiddleware('driver'), runController.getRunHistory);
router.get('/driver/:driverId/history', authMiddleware(['admin', 'manager', 'driver']), runController.getRunHistory);

router.post('/driver/runs/:runId/accept', authMiddleware('driver'), runController.acceptRun);
router.post('/driver/runs/:runId/end', authMiddleware('driver'), runController.endRun);
router.post('/driver/runs/:runId/stops/:stopId/update-status', authMiddleware('driver'), runController.driverUpdateStopStatus);
router.post('/driver/runs/:runId/stops/:stopId/failure', authMiddleware('driver'), runController.recordFailedDeliveryReason);

// --- Generic Run Mutation Routes ---
router.post('/:runId/optimize-route', authMiddleware(['admin', 'manager']), runController.optimizeRunRoute);
router.patch('/:runId/capacity', authMiddleware(['admin', 'manager']), runController.updateRunCapacity);
router.patch('/:runId/stops/:stopId/failure', authMiddleware(['admin', 'manager']), runController.recordFailedDeliveryReason);
router.put('/:runId/assign-driver', authMiddleware(['admin', 'manager']), runController.assignDriverToRun);

// --- Generic Run Read Route: keep last ---
router.get('/:runId', authMiddleware(), runController.getRun);

module.exports = router;
