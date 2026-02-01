// File: src/api/v1/utilities/power.controller.js
const powerService = require('./power.service');
const { logger } = require('../../../config/logger.config');

const validateMeter = async (req, res, next) => {
  try {
    const { meterNumber, discoCode, meterType } = req.body;
    
    if (!meterNumber || !discoCode) {
      return res.status(400).json({ success: false, message: "Meter number and Disco code are required" });
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
    const userId = req.user.id;
    const order = await powerService.createPendingOrder(userId, req.body);
    
    res.status(201).json({
      success: true,
      message: 'Order created successfully. Proceed to payment.',
      data: {
        orderId: order.id, // UUID
        totalAmount: order.totalAmount, // Includes Fee
        breakdown: {
          electricity: order.subTotal,
          fee: order.serviceFee
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

const retryVending = async (req, res, next) => {
  try {
    const { orderId } = req.body;
    // Security: Admin only check typically happens in middleware, but good to have here
    if (req.user.role !== 'admin') {
       return res.status(403).json({ success: false, message: "Admin rights required" });
    }

    const result = await powerService.vendPower(orderId);
    res.status(200).json({ success: true, message: "Retry successful", data: result });
  } catch (error) {
    next(error);
  }
};

module.exports = { validateMeter, createOrder, retryVending };