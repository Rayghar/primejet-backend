// File: src/api/v1/utilities/power.controller.js

const HttpError = require('../../../utils/HttpError');
const powerService = require('./power.service');

/**
 * POST /api/v1/power/validate
 * Accepts either:
 *  - { meterNumber, discoCode, meterType }   (legacy frontend)
 *  - { meterNumber, productCode, meterType } (new catalog-based frontend)
 */
const validateMeter = async (req, res, next) => {
  try {
    const meterNumber = req.body?.meterNumber;
    const discoCode = req.body?.discoCode;       // legacy (eko_electric_prepaid)
    const productCode = req.body?.productCode;   // new (from catalog)
    const meterType = req.body?.meterType || 'prepaid';

    if (!meterNumber) {
      return next(new HttpError(400, 'meterNumber is required'));
    }

    const providerOrProduct = productCode || discoCode;
    if (!providerOrProduct) {
      return next(new HttpError(400, 'discoCode or productCode is required'));
    }

    const result = await powerService.validateMeter(meterNumber, providerOrProduct, meterType);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
};

/**
 * POST /api/v1/power/order
 * Creates pending order prior to payment
 */
const createOrder = async (req, res, next) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) return next(new HttpError(401, 'Unauthorized'));

    const order = await powerService.createPendingOrder(userId, req.body);
    return res.status(201).json({
      message: 'Power order created',
      orderId: order._id,
      totalAmount: order.totalAmount,
      status: order.status,
    });
  } catch (err) {
    return next(err);
  }
};

/**
 * POST /api/v1/power/retry
 * Admin-only retry vending for stuck orders.
 */
const retryVending = async (req, res, next) => {
  try {
    // NOTE: Keep your existing admin check if you already have one elsewhere.
    // If you want to enforce here:
    // if (!req.user?.roles?.includes('admin')) return next(new HttpError(403, 'Forbidden'));

    const { orderId } = req.body || {};
    if (!orderId) return next(new HttpError(400, 'orderId is required'));

    const result = await powerService.vendPower(orderId);
    return res.status(200).json({ message: 'Retry processed', result });
  } catch (err) {
    return next(err);
  }
};

/**
 * GET /api/v1/power/billers?category=ELECTRICITY
 * Uses Monnify billers endpoint to return supported electricity billers.
 */
const getBillers = async (req, res, next) => {
  try {
    const category =
      req.query?.category ||
      req.query?.categoryCode ||
      'ELECTRICITY';

    const billers = await powerService.getElectricityBillers(category);
    return res.status(200).json({
      category,
      count: billers.length,
      billers,
    });
  } catch (err) {
    return next(err);
  }
};

/**
 * GET /api/v1/power/products?billerCode=XXXX
 * Returns products for a biller (if supported by your tenant).
 */
const getProducts = async (req, res, next) => {
  try {
    const billerCode = req.query?.billerCode || req.query?.biller_code;
    if (!billerCode) return next(new HttpError(400, 'billerCode is required'));

    const products = await powerService.getBillerProducts(billerCode);
    return res.status(200).json({
      billerCode,
      count: products.length,
      products,
    });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  validateMeter,
  createOrder,
  retryVending,
  getBillers,
  getProducts,
};
