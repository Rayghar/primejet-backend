// File: src/api/v1/utilities/power.controller.js
const powerService = require('./power.service');
const orderService = require('../orders/order.service');
const HttpError = require('../../../utils/HttpError');
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
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

const createOrder = async (req, res, next) => {
  try {
    const userId = req.user.id; // From Auth Middleware
    const order = await powerService.createPendingOrder(userId, req.body);

    // ✅ SAFETY FIX: Always return UUID order.id (not Mongo _id) so vending/retry works consistently
    res.status(201).json({
      success: true,
      message: 'Order created successfully. Proceed to payment.',
      data: {
        orderId: order.id,
        totalAmount: order.totalAmount, // Includes Convenience Fee
        breakdown: {
          electricity: order.subTotal,
          fee: order.serviceFee,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// --- Admin Retry Vending ---
const retryVending = async (req, res, next) => {
  try {
    const { orderId } = req.body;

    if (req.user.role !== 'admin') {
      throw new HttpError(403, 'Access Denied: Only Admins can retry vending.');
    }
    if (!orderId) throw new HttpError(400, 'Order ID is required');

    // Fetch order (service may accept either UUID or Mongo _id). We normalize to UUID.
    const order = await orderService.getOrder(orderId);
    if (!order) throw new HttpError(404, 'Order not found');

    const normalizedId = order.id || orderId;
    const result = await powerService.vendPower(normalizedId);

    res.status(200).json({
      success: true,
      message: 'Retry triggered. If VTpass is pending, requery will finalize.',
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// --- Requery (VTpass) ---
const requery = async (req, res, next) => {
  try {
    const { requestId } = req.body;
    if (!requestId) throw new HttpError(400, 'requestId is required');

    const data = await powerService.requeryVtpass(requestId);
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

module.exports = { validateMeter, createOrder, retryVending, requery };