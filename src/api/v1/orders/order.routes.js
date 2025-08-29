// src/api/v1/orders/order.routes.js
const express = require('express');
const orderController = require('./order.controller');
const authMiddleware = require('../../../middleware/auth.middleware');
const validate = require('../../../middleware/validate.middleware');
const {
  placeOrderSchema,
  processOrderPaymentSchema,
  submitFeedbackSchema,
  orderStatusUpdateSchema,
  adminAssignDriverSchema,
} = require('./order.validation');

const router = express.Router();

console.log('[ORDER_ROUTES] Registering order routes...');

// --- Customer specific routes ---
router.post(
  '/',
  authMiddleware('customer'),
  validate(placeOrderSchema),
  orderController.placeOrder
);

router.get(
  '/:orderId/payment-status',
  authMiddleware(),
  orderController.getOrderPaymentStatus
);

router.delete(
  '/:orderId',
  authMiddleware('customer'),
  orderController.cancelOrder
);

// =========================================================================
// NEW FUNCTIONALITY: New route for processPayment
// =========================================================================
router.post(
  '/:orderId/payment-complete',
  authMiddleware('customer'),
  validate(processOrderPaymentSchema),
  orderController.processPayment
);
// =========================================================================

router.post(
  '/:orderId/feedback',
  authMiddleware('customer'),
  validate(submitFeedbackSchema),
  orderController.submitFeedback
);

// =========================================================================
// FIX: Corrected the endpoint path to match what the front-end is calling.
// =========================================================================
router.get(
  '/me/stats', // FIX: Changed from '/me/consumption-stats' to '/me/stats'
  authMiddleware('customer'),
  orderController.getCustomerStats
);
// =========================================================================

// --- Driver specific routes ---
router.put(
  '/driver/:orderId/status',
  authMiddleware('driver'),
  validate(orderStatusUpdateSchema),
  orderController.driverUpdateOrderStatus
);

// --- Admin specific routes (defined before generic /:orderId to ensure correct matching) ---
router.get(
  '/admin',
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

// --- Routes accessible by authenticated users ---
router.get(
  '/',
  authMiddleware(),
  orderController.getOrders
);

router.get(
  '/:orderId',
  authMiddleware(),
  orderController.getOrder
);

router.get(
  '/:orderId/location-history',
  authMiddleware(),
  orderController.getLocationHistory
);

// << NEW ROUTE for the driver to trigger payment >>
router.put(
  '/:orderId/driver-arrived',
  authMiddleware('driver'),
  orderController.driverArrivedForPickup
);

router.put(
  '/:orderId/mark-as-verifying',
  authMiddleware('customer'),
  orderController.markAsVerifyingPayment
);

console.log('[ORDER_ROUTES] Order routes registered.');

module.exports = router;