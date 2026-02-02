// File: src/api/v1/utilities/power.controller.js
const powerService = require('./power.service');

const getProducts = async (req, res, next) => {
  try {
    const category = (req.query.category || 'ELECTRICITY').toString().toUpperCase();
    const result = await powerService.getProductsCatalog({ category });
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
};

const validateMeter = async (req, res, next) => {
  try {
    const { meterNumber, discoCode, productCode, meterType } = req.body;

    // Backward compatible: discoCode (old) OR productCode (new)
    const providerCode = productCode || discoCode;

    if (!meterNumber || !providerCode) {
      return res.status(400).json({
        success: false,
        message: 'Meter number and Provider code are required',
      });
    }

    const result = await powerService.validateMeter(meterNumber, providerCode, meterType);

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

const createOrder = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Backward compatible: discoCode (old) OR productCode (new)
    const { discoCode, productCode, ...rest } = req.body;
    const providerCode = productCode || discoCode;

    const order = await powerService.createPendingOrder(userId, {
      ...rest,
      discoCode: providerCode,
    });

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
      return res.status(403).json({ success: false, message: 'Admin rights required' });
    }

    const result = await powerService.vendPower(orderId);
    res.status(200).json({ success: true, message: 'Retry successful', data: result });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getProducts,
  validateMeter,
  createOrder,
  retryVending,
};
