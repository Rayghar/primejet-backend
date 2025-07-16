// src/api/v1/orders/order.controller.js
const orderService = require('./order.service'); // Path to co-located service
const HttpError = require('../../../utils/HttpError'); // Path to global HttpError utility
const { logger } = require('../../../config/logger.config'); // Path to global logger

// Controller for creating a new order
const createOrder = async (req, res, next) => {
  try {
    const customerId = req.user.id; // User ID from authMiddleware
    const orderData = { ...req.body, customerId };
    
    // Call the service function to create the order
    const result = await orderService.createOrder(orderData); // Service returns { order, paymentNeeded, grandTotalToPay }

    res.status(201).json({
      message: 'Order placed successfully. Please proceed to payment.',
      order: result.order, // The created order object
      paymentNeeded: result.paymentNeeded, // Boolean indicating if payment is needed
      grandTotalToPay: result.grandTotalToPay, // Amount to pay if paymentNeeded is true
    });
  } catch (error) {
    logger.error('[Order Controller] Error creating order:', { error: error.message, stack: error.stack, body: req.body });
    next(error); // Pass to error handling middleware
  }
};

// Controller for getting a single order by ID
const getOrderById = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const requestingUser = req.user; // User object from authMiddleware (contains id, role)

    // The service handles the authorization check based on the requesting user's role
    const order = await orderService.getOrderById(orderId, requestingUser);

    res.status(200).json(order); // Service returns order.toObject() directly
  } catch (error) {
    logger.error(`[Order Controller] Error fetching order ${req.params.orderId} by ID:`, { error: error.message, stack: error.stack });
    next(error);
  }
};

// Controller for getting all orders for the authenticated customer
const getOrdersByCustomerId = async (req, res, next) => {
  try {
    const customerId = req.user.id; // User ID from authMiddleware
    const orders = await orderService.getOrdersByCustomerId(customerId);
    res.status(200).json({ orders });
  } catch (error) {
    logger.error('[Order Controller] Error fetching user orders:', { error: error.message, stack: error.stack });
    next(error);
  }
};

// --- Existing Controller functions (placeholders, as they were in your original routes file) ---
// These functions would call their respective service methods.
// They are included here to maintain the structure expected by order.routes.js

const cancelOrder = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const customerId = req.user.id;
    const customerRole = req.user.role;
    const result = await orderService.cancelOrder(orderId, customerId, customerRole);
    res.status(200).json(result);
  } catch (error) {
    logger.error(`[Order Controller] Error canceling order ${req.params.orderId}:`, { error: error.message, stack: error.stack });
    next(error);
  }
};

const submitFeedback = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const feedbackData = req.body;
    const customerId = req.user.id;
    const customerRole = req.user.role;
    const result = await orderService.submitFeedback(orderId, feedbackData, customerId, customerRole);
    res.status(201).json(result);
  } catch (error) {
    logger.error(`[Order Controller] Error submitting feedback for order ${req.params.orderId}:`, { error: error.message, stack: error.stack });
    next(error);
  }
};

const getCustomerConsumptionData = async (req, res, next) => {
  try {
    const customerId = req.user.id;
    const data = await orderService.getCustomerConsumptionData(customerId);
    res.status(200).json(data);
  } catch (error) {
    logger.error(`[Order Controller] Error fetching consumption data for customer ${req.user.id}:`, { error: error.message, stack: error.stack });
    next(error);
  }
};

const driverUpdateOrderStatus = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { status, notes } = req.body;
    const driverId = req.user.id;
    const driverRole = req.user.role;
    const result = await orderService.driverUpdateOrderStatus(orderId, status, notes, driverId, driverRole);
    res.status(200).json(result);
  } catch (error) {
    logger.error(`[Order Controller] Error updating driver order status for ${req.params.orderId}:`, { error: error.message, stack: error.stack });
    next(error);
  }
};

const adminGetOrders = async (req, res, next) => {
  try {
    const options = { ...req.query, userId: req.user.id, role: req.user.role };
    const orders = await orderService.adminGetOrders(options);
    res.status(200).json(orders);
  } catch (error) {
    logger.error('[Order Controller] Error fetching admin orders:', { error: error.message, stack: error.stack });
    next(error);
  }
};

const adminUpdateOrderStatus = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { status, notes } = req.body;
    const adminId = req.user.id;
    const adminRole = req.user.role;
    const result = await orderService.adminUpdateOrderStatus(orderId, status, notes, adminId, adminRole);
    res.status(200).json(result);
  } catch (error) {
    logger.error(`[Order Controller] Error updating admin order status for ${req.params.orderId}:`, { error: error.message, stack: error.stack });
    next(error);
  }
};

const adminAssignDriver = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { driverId } = req.body;
    const adminId = req.user.id;
    const adminRole = req.user.role;
    const result = await orderService.adminAssignDriver(orderId, driverId, adminId, adminRole);
    res.status(200).json(result);
  } catch (error) {
    logger.error(`[Order Controller] Error assigning driver to order ${req.params.orderId}:`, { error: error.message, stack: error.stack });
    next(error);
  }
};

const getOrders = async (req, res, next) => {
  try {
    // This generic getOrders might need to delegate to specific role-based getters
    // or use a unified service method that handles roles.
    // For now, it calls the service's getOrders with options from query and user info.
    const options = { ...req.query, userId: req.user.id, role: req.user.role };
    const orders = await orderService.getOrders(options);
    res.status(200).json(orders);
  } catch (error) {
    logger.error('[Order Controller] Error fetching generic orders:', { error: error.message, stack: error.stack });
    next(error);
  }
};

const getOrder = async (req, res, next) => {
  try {
    // This generic getOrder might need to delegate to specific role-based getters
    // or use a unified service method that handles roles.
    const { orderId } = req.params;
    const requestingUser = req.user;
    const order = await orderService.getOrder(orderId, requestingUser);
    res.status(200).json(order);
  } catch (error) {
    logger.error(`[Order Controller] Error fetching generic order ${req.params.orderId}:`, { error: error.message, stack: error.stack });
    next(error);
  }
};

const getLocationHistory = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const requestingUserId = req.user.id;
    const requestingUserRole = req.user.role;
    const history = await orderService.getLocationHistory(orderId, requestingUserId, requestingUserRole);
    res.status(200).json(history);
  } catch (error) {
    logger.error(`[Order Controller] Error fetching location history for order ${req.params.orderId}:`, { error: error.message, stack: error.stack });
    next(error);
  }
};

module.exports = {
  createOrder,
  getOrderById,
  getOrdersByCustomerId,
  cancelOrder,
  submitFeedback,
  getCustomerConsumptionData,
  driverUpdateOrderStatus,
  adminGetOrders,
  adminUpdateOrderStatus,
  adminAssignDriver,
  getOrders, // Export the generic getOrders for existing routes
  getOrder, // Export the generic getOrder for existing routes
  getLocationHistory,
};
