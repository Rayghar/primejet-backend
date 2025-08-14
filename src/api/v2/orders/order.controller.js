// File: src/api/v1/orders/order.controller.js
const orderService = require('./order.service');
// Assuming paymentService is imported if createStripePaymentIntent is called here
// const paymentService = require('../payments/payment.service'); 
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config.js');
const orderServiceV1 = require('../../v1/orders/order.service'); // Reuse v1 service for core logic


const placeOrder = async (req, res, next) => {
  try {
    logger.info(`[ORDER_CONTROLLER] placeOrder initiated by user: ${req.user.id}`);
    // req.user.id IS the customerId from the token
    // req.body IS the orderData payload from the frontend
    if (typeof req.user.id !== 'string' || !req.user.id) {
        logger.error('[ORDER_CONTROLLER] customerId (req.user.id) is invalid:', req.user.id);
        return next(new HttpError(400, 'Invalid user identifier for placing order.'));
    }

    const result = await orderService.placeOrder(req.user.id, req.body); 

    // The call to paymentService.createPaymentIntent was in your file.
    // This should align with how your payment flow is designed.
    // If using Stripe and paymentService.createStripePaymentIntent is in order.service.js,
    // then the result already contains clientSecret and paymentIntentId.
    // If it's a separate call, ensure paymentService.createPaymentIntent is correctly defined.
    
    // For now, assuming result from orderService.placeOrder contains all necessary payment info:
    res.status(201).json(result); // result = { order, paymentIntentClientSecret, paymentIntentId, paymentNeeded, ... }

  } catch (error) {
    logger.error(`[ORDER_CONTROLLER] Error in placeOrder for user ${req.user.id}:`, { message: error.message, stack: error.stack });
    next(error);
  }
};

/**
 * @desc Fetches unassigned orders. Mirrors v1/runs/unassigned-orders logic.
 * @route GET /api/v2/orders/unassigned
 * @access Admin, Manager
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 * @param {function} next - Express next middleware function.
 */
const getUnassignedOrders = async (req, res, next) => {
    try {
        // Reuse the logic from the v1 run service to get unassigned orders
        // Note: The original getUnassignedOrders in v1 was in run.service.js,
        // here we are assuming it's refactored into a general order service or can be called.
        // For simplicity, we'll assume a direct call to a similar function in v1's order service
        // or that the v1 run service is made available.
        const { page = 1, limit = 10 } = req.query;
        const result = await orderServiceV1.getOrders({
            status: ['Order Placed', 'Pending Pickup', 'Ready for Delivery'], // Specific statuses for unassigned
            driverId: null, // Ensure driverId is null
            page: parseInt(page, 10),
            limit: parseInt(limit, 10),
            role: req.user.role, // Pass role for authorization within the service
            userId: req.user.id // Pass userId for authorization within the service
        });
        // Filter out orders that already have a driver assigned (double check if driverId: null works)
        const unassignedOrders = result.orders.filter(order => !order.driverId);

        res.status(200).json({
            orders: unassignedOrders,
            currentPage: result.currentPage,
            totalPages: result.totalPages,
            totalOrders: result.totalOrders // This might need adjustment if filtering changes total
        });
    } catch (error) {
        logger.error('Error fetching unassigned orders:', error);
        next(new HttpError(500, 'Failed to retrieve unassigned orders.'));
    }
};

// ... (rest of your order.controller.js methods: getOrders, getOrder, etc.)
const getOrders = async (req, res, next) => { /* ... */   try {
    const { status, customerId, driverId, page = 1, limit = 10, sortBy } = req.query;
    const result = await orderService.getOrders({ status, customerId, driverId, page: parseInt(page, 10), limit: parseInt(limit, 10), userId: req.user.id, role: req.user.role, sortBy});
    res.status(200).json(result);
  } catch (error) { next(error); }};
const getOrder = async (req, res, next) => { /* ... */   try {
    const order = await orderService.getOrder(req.params.orderId, req.user.id, req.user.role);
    res.status(200).json(order);
  } catch (error) { next(error); }};
const processOrderPayment = async (req, res, next) => { /* ... */   try {
    const result = await orderService.processPayment(req.params.orderId, req.body, req.user.id, req.user.role);
    res.status(200).json(result);
  } catch (error) { next(error); }};
const submitFeedback = async (req, res, next) => { /* ... */   try {
    const result = await orderService.submitFeedback(req.params.orderId, req.body, req.user.id, req.user.role);
    res.status(201).json(result);
  } catch (error) { next(error); }};
const getLocationHistory = async (req, res, next) => { /* ... */   try {
    const history = await orderService.getLocationHistory(req.params.orderId, req.user.id, req.user.role);
    res.status(200).json(history);
  } catch (error) { next(error); }};
const driverUpdateOrderStatus = async (req, res, next) => { /* ... */   try {
    const { status, notes } = req.body;
    const result = await orderService.driverUpdateOrderStatus(req.params.orderId, status, notes, req.user.id, req.user.role );
    res.status(200).json(result);
  } catch (error) { next(error); }};
const adminGetOrders = async (req, res, next) => { /* ... */   try {
    const { status, search, dateRangeStart, dateRangeEnd, page = 1, limit = 10, sortBy } = req.query;
    const result = await orderService.adminGetOrders({ status, search, dateRangeStart, dateRangeEnd, page: parseInt(page, 10), limit: parseInt(limit, 10), sortBy });
    res.status(200).json(result);
  } catch (error) { next(error); }};
const adminUpdateOrderStatus = async (req, res, next) => { /* ... */   try {
    const { status, notes } = req.body;
    const result = await orderService.adminUpdateOrderStatus(req.params.orderId, status, notes, req.user.id, req.user.role);
    res.status(200).json(result);
  } catch (error) { next(error); }};
const adminAssignDriver = async (req, res, next) => { /* ... */   try {
    const { driverId } = req.body;
    const result = await orderService.adminAssignDriver(req.params.orderId, driverId, req.user.id, req.user.role);
    res.status(200).json(result);
  } catch (error) { next(error); }};
const cancelOrder = async (req, res, next) => { /* ... */   try {
    const result = await orderService.cancelOrder(req.params.orderId, req.user.id, req.user.role);
    res.status(200).json(result);
  } catch (error) { next(error); }};

const getCustomerConsumptionData = async (req, res, next) => {
  try {
    const customerId = req.user.id;
    const result = await orderService.getCustomerConsumptionData(customerId);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};


module.exports = {
  getOrders,
  getOrder,
  placeOrder,
  processOrderPayment,
  submitFeedback,
  getLocationHistory,
  driverUpdateOrderStatus,
  adminGetOrders,
  adminUpdateOrderStatus,
  adminAssignDriver,
  cancelOrder,
  getCustomerConsumptionData,
  getUnassignedOrders,
};