// File: src/api/v1/orders/order.controller.js
const orderService = require('./order.service');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config.js');

const placeOrder = async (req, res, next) => {
  try {
    logger.info(`[ORDER_CONTROLLER] placeOrder initiated by user: ${req.user.id}`);
    if (typeof req.user.id !== 'string' || !req.user.id) {
        logger.error('[ORDER_CONTROLLER] customerId (req.user.id) is invalid:', req.user.id);
        return next(new HttpError(400, 'Invalid user identifier for placing order.'));
    }

    const result = await orderService.placeOrder(req.user.id, req.body); 
    res.status(201).json(result);

  } catch (error) {
    logger.error(`[ORDER_CONTROLLER] Error in placeOrder for user ${req.user.id}:`, { message: error.message, stack: error.stack });
    next(error);
  }
};

// << NEW CONTROLLER >>
const driverArrivedForPickup = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const result = await orderService.driverArrivedForPickup(orderId, req.user.id);
    res.status(200).json({ message: 'Status updated. Customer has been notified to pay.', order: result });
  } catch (error) {
    next(error);
  }
};

const markAsVerifyingPayment = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const result = await orderService.markAsVerifyingPayment(orderId, req.user.id);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

const getOrders = async (req, res, next) => {
  try {
    const { status, customerId, driverId, page = 1, limit = 10, sortBy } = req.query;
    const result = await orderService.getOrders({ status, customerId, driverId, page: parseInt(page, 10), limit: parseInt(limit, 10), userId: req.user.id, role: req.user.role, sortBy});
    res.status(200).json(result);
  } catch (error) { next(error); }
};

const getOrder = async (req, res, next) => {
  try {
    const order = await orderService.getOrder(req.params.orderId, req.user); // Use full user object as per new service function
    res.status(200).json(order);
  } catch (error) { next(error); }
};

const getOrderPaymentStatus = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const requestingUser = req.user;
    logger.info(`[ORDER_CONTROLLER] Fetching payment status for order ${orderId} by user ${requestingUser.id}`);
    const paymentStatusData = await orderService.getOrderPaymentStatus(orderId, requestingUser);
    res.status(200).json(paymentStatusData);
  } catch (error) {
    logger.error(`[ORDER_CONTROLLER] Error fetching payment status for order ${req.params.orderId}:`, { message: error.message, stack: error.stack });
    next(error);
  }
};

// =========================================================================
// NEW FUNCTIONALITY: New controller method to call the new service function
// =========================================================================
const processPayment = async (req, res, next) => {
  try {
    const result = await orderService.processPayment(req.params.orderId, req.body, req.user.id, req.user.role);
    res.status(200).json(result);
  } catch (error) { next(error); }
};
// =========================================================================

const submitFeedback = async (req, res, next) => {
  try {
    const result = await orderService.submitFeedback(req.params.orderId, req.body, req.user.id, req.user.role);
    res.status(201).json(result);
  } catch (error) { next(error); }
};

const getLocationHistory = async (req, res, next) => {
  try {
    const history = await orderService.getLocationHistory(req.params.orderId, req.user.id, req.user.role);
    res.status(200).json(history);
  } catch (error) { next(error); }
};

const driverUpdateOrderStatus = async (req, res, next) => {
  try {
    const { status, notes } = req.body;
    const result = await orderService.driverUpdateOrderStatus(req.params.orderId, status, notes, req.user.id, req.user.role );
    res.status(200).json(result);
  } catch (error) { next(error); }
};

const adminGetOrders = async (req, res, next) => {
  try {
    const { status, search, dateRangeStart, dateRangeEnd, page = 1, limit = 10, sortBy } = req.query;
    const result = await orderService.adminGetOrders({ status, search, dateRangeStart, dateRangeEnd, page: parseInt(page, 10), limit: parseInt(limit, 10), sortBy });
    res.status(200).json(result);
  } catch (error) { next(error); }
};

const adminUpdateOrderStatus = async (req, res, next) => {
  try {
    const { status, notes } = req.body;
    const result = await orderService.adminUpdateOrderStatus(req.params.orderId, status, notes, req.user.id, req.user.role);
    res.status(200).json(result);
  } catch (error) { next(error); }
};

const adminAssignDriver = async (req, res, next) => {
  try {
    const { driverId } = req.body;
    const result = await orderService.adminAssignDriver(req.params.orderId, driverId, req.user.id, req.user.role);
    res.status(200).json(result);
  } catch (error) { next(error); }
};

const cancelOrder = async (req, res, next) => {
  try {
    const result = await orderService.cancelOrder(req.params.orderId, req.user.id, req.user.role);
    res.status(200).json(result);
  } catch (error) { next(error); }
};

// =========================================================================
// NEW FUNCTIONALITY: New controller method to call the new service function
// =========================================================================
const getCustomerStats = async (req, res, next) => {
  try {
    const customerId = req.user.id;
    const result = await orderService.getCustomerStats(customerId);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};
// =========================================================================

module.exports = {
  getOrders,
  getOrder,
  placeOrder,
  processPayment, // Add the new processPayment controller here
  submitFeedback,
  getLocationHistory,
  driverUpdateOrderStatus,
  adminGetOrders,
  adminUpdateOrderStatus,
  adminAssignDriver,
  cancelOrder,
  getCustomerStats, // Export the new function
  getOrderPaymentStatus,
  driverArrivedForPickup,
  markAsVerifyingPayment,
};