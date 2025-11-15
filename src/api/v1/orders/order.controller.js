// File: src/api/v1/orders/order.controller.js
const orderService = require('./order.service');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config.js');

// ——— minimal, non-intrusive logging wrapper ———
const withLogging = (name, handler) => {
  return async (req, res, next) => {
    const meta = {
      route: req.originalUrl,
      method: req.method,
      userId: req.user?.id || null,
      role: req.user?.role || null,
      requestId: req.id || req.headers['x-request-id'] || null,
    };
    logger.info(`[ORDER_CONTROLLER] ${name}: start`, meta);
    try {
      await handler(req, res, next);
      logger.info(`[ORDER_CONTROLLER] ${name}: success`, meta);
    } catch (error) {
      logger.error(`[ORDER_CONTROLLER] ${name}: error`, {
        ...meta,
        message: error?.message,
        stack: error?.stack,
      });
      next(error);
    }
  };
};

// ==============================
// Customer / Common
// ==============================

const placeOrder = async (req, res, next) => {
  // expects: req.user.id (customer), req.body (order payload)
  if (typeof req.user?.id !== 'string' || !req.user.id) {
    return next(new HttpError(400, 'Invalid user identifier for placing order.'));
  }
  const result = await orderService.placeOrder(req.user.id, req.body);
  res.status(201).json(result);
};

const getOrders = async (req, res) => {
  // supports: ?status=&customerId=&driverId=&page=&limit=&sortBy=
  const { status, customerId, driverId, page = 1, limit = 10, sortBy } = req.query;
  const result = await orderService.getOrders({
    status,
    customerId,
    driverId,
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
    userId: req.user.id,
    role: req.user.role,
    sortBy,
  });
  res.status(200).json(result);
};

const getOrder = async (req, res) => {
  // uses full user object for authz inside service
  const order = await orderService.getOrder(req.params.orderId, req.user);
  res.status(200).json(order);
};

const getOrderPaymentStatus = async (req, res) => {
  const { orderId } = req.params;
  const paymentStatusData = await orderService.getOrderPaymentStatus(orderId, req.user);
  res.status(200).json(paymentStatusData);
};

const processPayment = async (req, res) => {
  // customer flow: POST /orders/:orderId/pay
  const result = await orderService.processPayment(
    req.params.orderId,
    req.body,
    req.user.id,
    req.user.role
  );
  res.status(200).json(result);
};

const submitFeedback = async (req, res) => {
  const result = await orderService.submitFeedback(
    req.params.orderId,
    req.body,
    req.user.id,
    req.user.role
  );
  res.status(201).json(result);
};

const getLocationHistory = async (req, res) => {
  const history = await orderService.getLocationHistory(
    req.params.orderId,
    req.user.id,
    req.user.role
  );
  res.status(200).json(history);
};

const cancelOrder = async (req, res) => {
  const result = await orderService.cancelOrder(
    req.params.orderId,
    req.user.id,
    req.user.role
  );
  res.status(200).json(result);
};

// ==============================
// Driver actions
// ==============================

const driverUpdateOrderStatus = async (req, res) => {
  const { status, notes } = req.body;
  const result = await orderService.driverUpdateOrderStatus(
    req.params.orderId,
    status,
    notes,
    req.user.id,
    req.user.role
  );
  res.status(200).json(result);
};

const driverArrivedForPickup = async (req, res) => {
  const { orderId } = req.params;
  const result = await orderService.driverArrivedForPickup(orderId, req.user.id);
  res
    .status(200)
    .json({ message: 'Status updated. Customer has been notified to pay.', order: result });
};

// ==============================
// Payment verification enhancements
// ==============================

const markAsVerifyingPayment = async (req, res) => {
  // customer calls when they’ve initiated payment (moves to “Verifying Payment” and timestamps)
  const { orderId } = req.params;
  const result = await orderService.markAsVerifyingPayment(orderId, req.user.id);
  res.status(200).json(result);
};

// Optional: admin/ops can trigger the sweep in addition to cron/queue
const runVerificationDelayCheck = async (_req, res) => {
  const result = await orderService.checkAndFlagVerificationDelays();
  res.status(200).json({ message: 'Verification delay sweep completed.', ...result });
};

// ==============================
// Admin views/actions
// ==============================

const adminGetOrders = async (req, res) => {
  const { status, search, dateRangeStart, dateRangeEnd, page = 1, limit = 10, sortBy } = req.query;
  const result = await orderService.adminGetOrders({
    status,
    search,
    dateRangeStart,
    dateRangeEnd,
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
    sortBy,
  });
  res.status(200).json(result);
};

const adminUpdateOrderStatus = async (req, res) => {
  const { status, notes } = req.body;
  const result = await orderService.adminUpdateOrderStatus(
    req.params.orderId,
    status,
    notes,
    req.user.id,
    req.user.role
  );
  res.status(200).json(result);
};

const adminAssignDriver = async (req, res) => {
  const { driverId } = req.body;
  const result = await orderService.adminAssignDriver(
    req.params.orderId,
    driverId,
    req.user.id,
    req.user.role
  );
  res.status(200).json(result);
};

// ==============================
// Metrics (customer & driver)
// ==============================

const getCustomerStats = async (req, res) => {
  const customerId = req.user.id;
  const result = await orderService.getCustomerStats(customerId);
  res.status(200).json(result);
};

const getDriverFulfillmentMetrics = async (req, res) => {
  // supports: ?from=YYYY-MM-DD&to=YYYY-MM-DD  (optional)
  const { from, to } = req.query;
  const driverId =
    req.user.role === 'driver'
      ? req.user.id
      : (req.params.driverId || req.query.driverId); // allow admin to specify a driver
  if (!driverId) {
    throw new HttpError(400, 'driverId is required (or be authenticated as a driver).');
  }
  const result = await orderService.getDriverFulfillmentMetrics(driverId, { from, to });
  res.status(200).json(result);
};

// ==============================
// Exports (auto-wrapped with logging)
// ==============================

module.exports = {
  // customer/common
  getOrders,
  getOrder,
  placeOrder,
  processPayment,
  submitFeedback,
  getLocationHistory,
  cancelOrder,

  // driver
  driverUpdateOrderStatus,
  driverArrivedForPickup,

  // payment verification
  markAsVerifyingPayment,
  runVerificationDelayCheck, // optional ops/admin trigger

  // admin
  adminGetOrders,
  adminUpdateOrderStatus,
  adminAssignDriver,

  // metrics
  getCustomerStats,
  getDriverFulfillmentMetrics,

  // status/payment info
  getOrderPaymentStatus,
};

// ——— wrap all exported handlers with logging ———
module.exports = Object.fromEntries(
  Object.entries(module.exports).map(([key, fn]) => {
    if (typeof fn === 'function') return [key, withLogging(key, fn)];
    return [key, fn];
  })
);
