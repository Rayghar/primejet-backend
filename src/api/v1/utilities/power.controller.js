// File: src/api/v1/utilities/power.controller.js
const powerService = require('./power.service');
const orderService = require('../orders/order.service'); // <--- ADDED
const HttpError = require('../../../utils/HttpError'); // <--- ADDED
const { logger } = require('../../../config/logger.config');

const validateMeter = async (req, res, next) => {
  try {
    const { meterNumber, discoCode, meterType } = req.body;
    
    if (!meterNumber || !discoCode) {
      throw new HttpError(400, 'Meter number and Disco code are required');
    }

    const result = await powerService.validateMeter(meterNumber, discoCode, meterType);
    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
};

const createOrder = async (req, res, next) => {
  try {
    const userId = req.user.id; // From Auth Middleware
    const order = await powerService.createPendingOrder(userId, req.body);
    
    res.status(201).json({
      success: true,
      message: 'Order created successfully. Proceed to payment.',
      data: {
        orderId: order._id || order.id,
        totalAmount: order.totalAmount, // Includes Convenience Fee
        breakdown: {
          electricity: order.subTotal,
          fee: order.serviceFee // Updated to match order model field
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

// --- NEW FUNCTION: Admin Retry ---
const retryVending = async (req, res, next) => {
  try {
    const { orderId } = req.body;
    
    // 1. Security Check (Safety First)
    if (req.user.role !== 'admin') {
      throw new HttpError(403, 'Access Denied: Only Admins can retry vending.');
    }

    if (!orderId) {
        throw new HttpError(400, 'Order ID is required');
    }

    // 2. Fetch Order to ensure it exists
    const order = await orderService.getOrder(orderId);
    if (!order) throw new HttpError(404, 'Order not found');

    // 3. Trigger Retry
    const result = await powerService.vendPower(orderId);

    res.status(200).json({
      success: true,
      message: 'Retry successful. Token generated.',
      data: result
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { validateMeter, createOrder, retryVending };