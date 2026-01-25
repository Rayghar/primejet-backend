// File: src/api/v1/utilities/power.controller.js
const powerService = require('./power.service');
const orderService = require('../orders/order.service');
const HttpError = require('../../../utils/HttpError');

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
    const userId = req.user.id; // from auth middleware
    const order = await powerService.createPendingOrder(userId, req.body);

    // ✅ always return UUID order.id (not Mongo _id)
    res.status(201).json({
      success: true,
      message: 'Order created successfully. Proceed to payment.',
      data: {
        orderId: order.id,
        totalAmount: order.totalAmount,
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

const retryVending = async (req, res, next) => {
  try {
    const { orderId } = req.body;

    if (req.user.role !== 'admin') {
      throw new HttpError(403, 'Access Denied: Only Admins can retry vending.');
    }
    if (!orderId) throw new HttpError(400, 'Order ID is required');

    const order = await orderService.getOrder(orderId);
    if (!order) throw new HttpError(404, 'Order not found');

    const normalizedId = order.id || orderId;
    const result = await powerService.vendPower(normalizedId);

    res.status(200).json({
      success: true,
      message: 'Retry triggered.',
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

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