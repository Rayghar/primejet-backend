// src/api/v1/run_orchestration/run_orchestration.routes.js
const express = require('express');
const runOrchestrationController = require('./run_orchestration.controller');
const authMiddleware = require('../../../middleware/auth.middleware');
const validate = require('../../../middleware/validate.middleware');
const { adminAssignDriverSchema, createBatchRunSchema } = require('../orders/order.validation'); // Reusing existing validation schemas if compatible

const router = express.Router();

console.log('[RUN_ORCHESTRATION_ROUTES] Registering run orchestration routes...');

// Route for admin to assign a driver to a single order (now handled by orchestration)
router.post(
  '/admin/assign-order-driver/:orderId', // New, more specific route
  authMiddleware('admin'),
  validate(adminAssignDriverSchema), // Reuse schema from orders
  runOrchestrationController.adminAssignOrderToDriver
);

// Route for admin to create a batch run from multiple orders (now handled by orchestration)
router.post(
  '/admin/create-batch-run', // New route, clearer name
  authMiddleware('admin'),
  validate(createBatchRunSchema), // Assuming you have a schema for orderIds list
  runOrchestrationController.adminCreateRunFromOrders
);

console.log('[RUN_ORCHESTRATION_ROUTES] Run orchestration routes registered.');

module.exports = router;