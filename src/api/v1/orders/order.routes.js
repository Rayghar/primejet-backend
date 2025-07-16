// src/api/v1/orders/order.routes.js
const express = require('express');
const router = express.Router();
const orderController = require('./order.controller');
const authMiddleware = require('../../../middleware/auth.middleware'); // Assuming auth middleware path
const validate = require('../../../middleware/validate.middleware'); // Assuming validate middleware path
const { placeOrderSchema, submitFeedbackSchema, orderStatusUpdateSchema, adminAssignDriverSchema, orderIdParamSchema } = require('./order.validation'); // Assuming validation schemas path

// Public routes (if any, typically none for orders except perhaps confirmation pages)
// No public order routes for now

// Customer routes
router.post('/', authMiddleware('customer'), validate(placeOrderSchema, 'body'), orderController.placeOrder);
router.get('/', authMiddleware(['customer', 'admin', 'driver']), orderController.getOrders); // Can be filtered by role in service
router.get('/:orderId', authMiddleware(['customer', 'admin', 'driver']), orderController.getOrderDetails);
router.post('/:orderId/feedback', authMiddleware('customer'), validate(submitFeedbackSchema, 'body'), orderController.submitFeedback);
router.get('/:orderId/location-history', authMiddleware(['customer', 'driver']), orderController.getLocationHistory);
router.post('/:orderId/cancel', authMiddleware('customer'), orderController.cancelOrder);
router.get('/me/consumption-data', authMiddleware('customer'), orderController.getCustomerConsumptionData); // New route for consumption data

// NEW: Route for fetching order payment status (for frontend reconciliation)
router.get(
  '/:orderId/payment-status',
  authMiddleware('customer'),
  orderController.getOrderPaymentStatus
);

// Driver routes
router.patch('/:orderId/driver-status', authMiddleware('driver'), validate(orderStatusUpdateSchema, 'body'), orderController.driverUpdateOrderStatus);

// Admin routes
router.get('/admin', authMiddleware('admin'), orderController.adminGetOrders); // Admin can get all orders with filters
router.patch('/admin/:orderId/status', authMiddleware('admin'), validate(orderStatusUpdateSchema, 'body'), orderController.adminUpdateOrderStatus);
router.patch('/admin/:orderId/assign-driver', authMiddleware('admin'), validate(adminAssignDriverSchema, 'body'), orderController.adminAssignDriver);

module.exports = router;