// src/api/v1/orders/order.controller.js
const orderService = require('./order.service');
const { logger } = require('../../../config/logger.config'); // Ensure logger is imported
const HttpError = require('../../../utils/HttpError');

// Controller for placing a new order
const placeOrder = async (req, res, next) => {
  try {
    const customerId = req.user.id;
    const orderData = req.body;
    const result = await orderService.placeOrder(customerId, orderData);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
};

// Controller for fetching single order details
const getOrderDetails = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const requestingUser = req.user; // User object from auth middleware
    const order = await orderService.getOrder(orderId, requestingUser);
    res.status(200).json(order);
  } catch (error) {
    next(error);
  }
};

// Controller for fetching list of orders (customer, driver, admin)
const getOrders = async (req, res, next) => {
  try {
    const options = {
      ...req.query, // page, limit, status, sortBy, customerId, driverId
      userId: req.user.id,
      role: req.user.role,
    };
    const orders = await orderService.getOrders(options);
    res.status(200).json(orders);
  } catch (error) {
    next(error);
  }
};

// NEW: Controller for fetching payment status of an order
const getOrderPaymentStatus = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const customerId = req.user.id; // Assuming req.user.id holds the authenticated customer's ID

    const result = await orderService.getOrderPaymentStatus(orderId, customerId);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

// Controller for submitting feedback
const submitFeedback = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const feedbackData = req.body;
    const customerId = req.user.id;
    const customerRole = req.user.role;
    const result = await orderService.submitFeedback(orderId, feedbackData, customerId, customerRole);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

// Controller for getting location history
const getLocationHistory = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const requestingUserId = req.user.id;
    const requestingUserRole = req.user.role;
    const locations = await orderService.getLocationHistory(orderId, requestingUserId, requestingUserRole);
    res.status(200).json(locations);
  } catch (error) {
    next(error);
  }
};

// Controller for driver to update order status
const driverUpdateOrderStatus = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { status, notes } = req.body;
    const driverId = req.user.id;
    const driverRole = req.user.role;
    const result = await orderService.driverUpdateOrderStatus(orderId, status, notes, driverId, driverRole);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

// Admin specific order controllers
const adminGetOrders = async (req, res, next) => {
  try {
    const options = req.query; // status, search, dateRangeStart, dateRangeEnd, page, limit, sortBy
    const orders = await orderService.adminGetOrders(options);
    res.status(200).json(orders);
  } catch (error) {
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
    next(error);
  }
};

// Controller for customer to cancel an order
const cancelOrder = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const customerId = req.user.id;
    const customerRole = req.user.role;
    const result = await orderService.cancelOrder(orderId, customerId, customerRole);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

const getCustomerConsumptionData = async (req, res, next) => {
  try {
    const customerId = req.user.id;
    const data = await orderService.getCustomerConsumptionData(customerId);
    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  placeOrder,
  getOrderDetails,
  getOrders,
  getOrderPaymentStatus, // NEW: Export the new controller function
  submitFeedback,
  getLocationHistory,
  driverUpdateOrderStatus,
  adminGetOrders,
  adminUpdateOrderStatus,
  adminAssignDriver,
  cancelOrder,
  getCustomerConsumptionData,
  
};