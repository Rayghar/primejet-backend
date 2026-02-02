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

/**
 * POST /api/v1/power/validate
 *
 * Backward compatible request body:
 * - NEW: { meterNumber, discoCode, productCode, meterType }
 * - OLD (Flutter logs): { meter, disco }
 */
const validateMeter = async (req, res, next) => {
  try {
    const {
      // New / preferred
      meterNumber,
      discoCode,
      productCode,
      meterType,

      // Backward-compatible (existing Flutter)
      meter,
      disco,
    } = req.body || {};

    const resolvedMeter = (meterNumber || meter || '').toString().trim();
    // Backward compatible: productCode (new) OR discoCode (old) OR disco (older)
    const providerCode = (productCode || discoCode || disco || '').toString().trim();

    if (!resolvedMeter || !providerCode) {
      return res.status(400).json({
        success: false,
        message: 'Meter number and Provider code are required',
      });
    }

    const result = await powerService.validateMeter(resolvedMeter, providerCode, meterType);

    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/power/order
 *
 * Backward compatible request body:
 * - NEW: { meterNumber, discoCode/productCode, amount, phone, email, meterName, meterType, validationReference }
 * - OLD: { meter, disco, amount, phone, meterName, validationReference }
 */
const createOrder = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const {
      // New / preferred fields
      meterNumber,
      discoCode,
      productCode,
      meterType,
      amount,
      phone,
      email,
      meterName,
      validationReference,

      // Backward-compatible fields (Flutter / older clients)
      meter,
      disco,

      // allow extra fields without breaking
      ...rest
    } = req.body || {};

    const resolvedMeter = (meterNumber || meter || '').toString().trim();
    const providerCode = (productCode || discoCode || disco || '').toString().trim();

    if (!resolvedMeter || !providerCode) {
      return res.status(400).json({
        success: false,
        message: 'Meter number and Provider code are required',
      });
    }

    const order = await powerService.createPendingOrder(userId, {
      ...rest,
      meterNumber: resolvedMeter,
      discoCode: providerCode, // service will resolve to productCode safely
      meterType,
      amount,
      phone,
      email,
      meterName,
      validationReference,
    });

    return res.status(201).json({
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
    const { orderId } = req.body || {};

    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin rights required' });
    }

    if (!orderId) {
      return res.status(400).json({ success: false, message: 'orderId is required' });
    }

    const result = await powerService.vendPower(orderId);
    return res.status(200).json({ success: true, message: 'Retry successful', data: result });
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
