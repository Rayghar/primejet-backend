// src/api/v1/orders/order.routes.js
const express = require('express');
const orderController = require('./order.controller'); // Path to co-located controller
const authMiddleware = require('../../../middleware/auth.middleware'); // Path to global auth middleware
const validate = require('../../../middleware/validate.middleware'); // Path to global validate middleware
const {
  placeOrderSchema,
  processOrderPaymentSchema,
  submitFeedbackSchema,
  orderStatusUpdateSchema,
  adminAssignDriverSchema,
} = require('./order.validation'); // Path to co-located validation schemas

const router = express.Router();

console.log('[ORDER_ROUTES] Registering order routes...');

// --- Customer specific routes ---
router.post(
  '/',
  authMiddleware('customer'),
  validate(placeOrderSchema),
  orderController.placeOrder
);

router.delete(
  '/:orderId',
  authMiddleware('customer'),
  orderController.cancelOrder
);

// This route for /:orderId/payment might need to be adjusted or removed
// if all payment processing is now handled directly by the OPay SDK on the frontend
// and webhooks on the backend.
router.post(
  '/:orderId/payment',
  authMiddleware('customer'),
  validate(processOrderPaymentSchema),
  orderController.processOrderPayment
);

router.post(
  '/:orderId/feedback',
  authMiddleware('customer'),
  validate(submitFeedbackSchema),
  orderController.submitFeedback
);

router.get(
  '/me/consumption-data', // New route
  authMiddleware('customer'),
  orderController.getCustomerConsumptionData
);
// --- Driver specific routes ---
router.put(
  '/driver/:orderId/status', // Specific path for driver updates
  authMiddleware('driver'),
  validate(orderStatusUpdateSchema),
  orderController.driverUpdateOrderStatus
);

// --- Admin specific routes (defined before generic /:orderId to ensure correct matching) ---
router.get(
  '/admin', // Path for admin to get orders
  authMiddleware('admin'),
  orderController.adminGetOrders
);

router.put(
  '/admin/:orderId/status',
  authMiddleware('admin'),
  validate(orderStatusUpdateSchema),
  orderController.adminUpdateOrderStatus
);

router.post(
  '/admin/:orderId/assign-driver',
  authMiddleware('admin'),
  validate(adminAssignDriverSchema),
  orderController.adminAssignDriver
);

// --- Routes accessible by authenticated users (customer, driver, admin - logic handled in service/controller) ---
// Generic get all orders (filtered by role in service)
router.get(
  '/',
  authMiddleware(), // Any authenticated user can access, service layer filters based on role
  orderController.getOrders
);

// Generic get single order (filtered by role in service)
router.get(
  '/:orderId',
  authMiddleware(), // Any authenticated user can access, service layer filters based on role
  orderController.getOrder
);

router.get(
  '/:orderId/location-history',
  authMiddleware(), // Any authenticated user, service layer filters
  orderController.getLocationHistory
);

console.log('[ORDER_ROUTES] Order routes registered.');

module.exports = router;