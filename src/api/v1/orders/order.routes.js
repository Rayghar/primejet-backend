// File: src/api/v1/orders/order.routes.js
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

// ---------------------------------------------------------------------------
// CUSTOMER ROUTES
// ---------------------------------------------------------------------------

// Place a new order
router.post(
  '/',
  authMiddleware('customer'),
  validate(placeOrderSchema),
  orderController.placeOrder
);

// Customer: mark that payment has been initiated (moves to "Verifying Payment")
router.put(
  '/:orderId/mark-as-verifying',
  authMiddleware('customer'),
  orderController.markAsVerifyingPayment
);

// Complete payment (client-initiated confirmation path)
router.post(
  '/:orderId/payment-complete',
  authMiddleware('customer'),
  validate(processOrderPaymentSchema),
  orderController.processPayment
);

// Cancel order (only if still pending payment)
router.delete(
  '/:orderId',
  authMiddleware('customer'),
  orderController.cancelOrder
);

// Submit feedback after delivery
router.post(
  '/:orderId/feedback',
  authMiddleware('customer'),
  validate(submitFeedbackSchema),
  orderController.submitFeedback
);

// Customer stats (consumption/recency summary)
router.get(
  '/me/stats', // kept as agreed
  authMiddleware('customer'),
  orderController.getCustomerStats
);

// Payment status (any authenticated role who is authorized to view the order)
router.get(
  '/:orderId/payment-status',
  authMiddleware(),
  orderController.getOrderPaymentStatus
);

// ---------------------------------------------------------------------------
// DRIVER ROUTES
// ---------------------------------------------------------------------------

// Driver updates order status (Processing, Out for Delivery, Delivered, etc.)
router.put(
  '/driver/:orderId/status',
  authMiddleware('driver'),
  validate(orderStatusUpdateSchema),
  orderController.driverUpdateOrderStatus
);

// Driver arrived at customer location (for Pay-on-Arrival or nudging customer)
router.put(
  '/:orderId/driver-arrived',
  authMiddleware('driver'),
  orderController.driverArrivedForPickup
);

// Driver self metrics (fulfillment KPIs for the authenticated driver)
router.get(
  '/metrics/driver/me',
  authMiddleware('driver'),
  orderController.getDriverFulfillmentMetrics
);

// ---------------------------------------------------------------------------
// ADMIN ROUTES (declare BEFORE generic /:orderId to avoid shadowing)
// ---------------------------------------------------------------------------

// Admin list/search orders
router.get(
  '/admin',
  authMiddleware('admin'),
  orderController.adminGetOrders
);

// Admin update order status
router.put(
  '/admin/:orderId/status',
  authMiddleware('admin'),
  validate(orderStatusUpdateSchema),
  orderController.adminUpdateOrderStatus
);

// Admin assign driver
router.post(
  '/admin/:orderId/assign-driver',
  authMiddleware('admin'),
  validate(adminAssignDriverSchema),
  orderController.adminAssignDriver
);

// Admin: driver fulfillment metrics for any driver (by id)
router.get(
  '/metrics/driver/:driverId',
  authMiddleware('admin'),
  orderController.getDriverFulfillmentMetrics
);

// Admin/Ops: trigger verification delay sweep (complements cron/queue)
router.post(
  '/ops/payment-delay-scan',
  authMiddleware('admin'),
  orderController.runVerificationDelayCheck
);

// ---------------------------------------------------------------------------
// SHARED / AUTHENTICATED ROUTES
// ---------------------------------------------------------------------------

// Paginated list of orders scoped by role
router.get(
  '/',
  authMiddleware(),
  orderController.getOrders
);

// Get a specific order (role-aware authorization in service)
router.get(
  '/:orderId',
  authMiddleware(),
  orderController.getOrder
);

// Location history (authorized customer/driver only)
router.get(
  '/:orderId/location-history',
  authMiddleware(),
  orderController.getLocationHistory
);

console.log('[ORDER_ROUTES] Order routes registered.');

module.exports = router;
