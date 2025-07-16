// src/api/v1/orders/order.routes.js
const express = require('express');
const orderController = require('./order.controller'); // Path to co-located controller
const authMiddleware = require('../../../middleware/auth.middleware'); // Path to global auth middleware
const validate = require('../../../middleware/validate.middleware'); // Path to global validate middleware
const {
  placeOrderSchema, // Assuming this is the schema for creating an order
  submitFeedbackSchema,
  orderStatusUpdateSchema,
  adminAssignDriverSchema,
} = require('./order.validation'); // Path to co-located validation schemas

const router = express.Router();

console.log('[ORDER_ROUTES] Registering order routes...');

// --- Customer specific routes ---

// Create a new order (initial status will be 'pending_payment')
router.post(
  '/',
  authMiddleware('customer'), // Ensure only customers can place orders
  validate(placeOrderSchema), // Use the schema for order creation
  orderController.createOrder // New controller function for order creation
);

router.delete(
  '/:orderId',
  authMiddleware('customer'),
  orderController.cancelOrder
);

// !!! IMPORTANT: The client-side payment confirmation route is removed.
// It is no longer used as payment confirmation is now handled securely
// by Monnify webhooks on the backend.
// router.post(
//   '/:orderId/payment',
//   authMiddleware('customer'),
//   validate(processOrderPaymentSchema), // This schema should also be removed if not used elsewhere
//   orderController.processOrderPayment // This controller function should also be removed or repurposed
// );

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

// Get all orders for the authenticated user (customer)
router.get(
  '/me', // Specific route for authenticated user's orders
  authMiddleware('customer'),
  orderController.getOrdersByCustomerId // New controller function
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
// Generic get all orders (filtered by role in service) - This route is now implicitly handled by /me for customers
// and admin/driver specific routes, so it can be removed or repurposed if not needed generically.
// For now, I will keep the existing generic / route but ensure it uses the appropriate controller method
// based on the new service functions.
router.get(
  '/',
  authMiddleware(), // Any authenticated user can access, service layer filters based on role
  orderController.getOrders // This will likely need to be adjusted in controller to use getOrdersByCustomerId if role is customer
);

// Get single order by ID (for frontend polling/display)
router.get(
  '/:orderId',
  authMiddleware(), // Any authenticated user can access, service layer filters based on role
  orderController.getOrderById // New controller function for fetching by ID
);

router.get(
  '/:orderId/location-history',
  authMiddleware(), // Any authenticated user, service layer filters
  orderController.getLocationHistory
);

console.log('[ORDER_ROUTES] Order routes registered.');

module.exports = router;
