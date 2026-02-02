// File: src/api/v1/utilities/power.service.js

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');
const orderService = require('../orders/order.service');
const notificationService = require('../notifications/notification.service');

// -----------------------------------------------------------------------------
// CONFIGURATION
// -----------------------------------------------------------------------------

// Sandbox: https://sandbox.monnify.com
// Live:    https://api.monnify.com
const BASE_URL = process.env.MONNIFY_BASE_URL || 'https://sandbox.monnify.com';
const API_KEY = process.env.MONNIFY_API_KEY;
const SECRET_KEY = process.env.MONNIFY_SECRET_KEY;

const CONVENIENCE_FEE = parseFloat(process.env.POWER_CONVENIENCE_FEE || '100');

// Timeouts
const HTTP_TIMEOUT = 30000; // 30s
const VEND_TIMEOUT = 45000; // 45s

// Axios instance (centralised + safe status handling)
const monnifyHttp = axios.create({
  baseURL: BASE_URL,
  timeout: HTTP_TIMEOUT,
  validateStatus: () => true, // never throw on 4xx/5xx
});

// Log service load (helps confirm deployed version)
logger.info('[POWER_SERVICE] loaded version=2026-02-02');

// -----------------------------------------------------------------------------
// HELPERS
// -----------------------------------------------------------------------------

/**
 * Map frontend disco codes → Monnify product codes (fallback mode).
 */
const mapDiscoToMonnifyCode = (code, type = 'prepaid') => {
  const isPrepaid = String(type || 'prepaid').toLowerCase().includes('prepaid');

  const map = {
    ikeja_electric_prepaid: 'MOB_PREPAID_IKEJA',
    eko_electric_prepaid: 'MOB_PREPAID_EKO',
    abuja_electric_prepaid: 'MOB_PREPAID_ABUJA',
    ibadan_electric_prepaid: 'MOB_PREPAID_IBADAN',
    enugu_electric_prepaid: 'MOB_PREPAID_ENUGU',
    jos_electric_prepaid: 'MOB_PREPAID_JOS',
    kano_electric_prepaid: 'MOB_PREPAID_KANO',
    portharcourt_electric_prepaid: 'MOB_PREPAID_PH',

    ikeja_electric: isPrepaid ? 'MOB_PREPAID_IKEJA' : 'MOB_POSTPAID_IKEJA',
    eko_electric: isPrepaid ? 'MOB_PREPAID_EKO' : 'MOB_POSTPAID_EKO',
  };

  return map[String(code || '').trim()] || 'MOB_PREPAID_IKEJA';
};

/**
 * If caller already sends a Monnify productCode (e.g. "MOB_PREPAID_IKEJA"),
 * use it directly. Otherwise map from disco shorthand.
 */
const resolveProductCode = (providerCode, meterType = 'prepaid') => {
  const c = String(providerCode || '').trim();
  if (!c) return null;

  // Heuristic: Monnify electricity codes in your mapping are "MOB_*"
  if (c.toUpperCase().startsWith('MOB_')) return c;

  return mapDiscoToMonnifyCode(c, meterType);
};

/**
 * AUTH (Diagnostic, safe: no secrets printed)
 */
const getAccessToken = async () => {
  const hasKey = !!API_KEY;
  const hasSecret = !!SECRET_KEY;

  logger.info(
    `[Monnify][AUTH] start baseUrl=${BASE_URL} hasKey=${hasKey} hasSecret=${hasSecret}`
  );

  if (!hasKey || !hasSecret) {
    throw new HttpError(
      500,
      'Monnify credentials missing: MONNIFY_API_KEY / MONNIFY_SECRET_KEY'
    );
  }

  try {
    const authString = Buffer.from(`${API_KEY}:${SECRET_KEY}`).toString('base64');

    const response = await monnifyHttp.post(
      '/api/v1/auth/login',
      {},
      { headers: { Authorization: `Basic ${authString}` } }
    );

    const { status, data } = response;

    logger.info(
      `[Monnify][AUTH] status=${status} requestSuccessful=${!!data?.requestSuccessful} message=${data?.responseMessage || 'n/a'}`
    );

    if (data?.requestSuccessful && data?.responseBody?.accessToken) {
      logger.info('[Monnify][AUTH] success');
      return data.responseBody.accessToken;
    }

    throw new Error(data?.responseMessage || 'No access token returned');
  } catch (err) {
    const status = err?.response?.status;
    const providerMsg =
      err?.response?.data?.responseMessage ||
      err?.response?.data?.message ||
      err.message;

    logger.error(`[Monnify][AUTH][FAIL] status=${status || 'n/a'} message=${providerMsg}`);

    throw new HttpError(502, `Service authentication failed: ${providerMsg}`);
  }
};

// -----------------------------------------------------------------------------
// CATALOG (Fixes /power/products 404)
// -----------------------------------------------------------------------------

/**
 * Lightweight catalog for frontend dropdowns.
 * You can later replace with Monnify product discovery if/when available.
 */
const getProductsCatalog = async ({ category = 'ELECTRICITY' } = {}) => {
  const cat = String(category || 'ELECTRICITY').toUpperCase();

  // Only electricity for now
  if (cat !== 'ELECTRICITY') return [];

  return [
    { code: 'ikeja_electric_prepaid', name: 'Ikeja Electric (Prepaid)', meterType: 'prepaid', category: 'ELECTRICITY' },
    { code: 'eko_electric_prepaid', name: 'Eko Electric (Prepaid)', meterType: 'prepaid', category: 'ELECTRICITY' },
    { code: 'abuja_electric_prepaid', name: 'Abuja Electric (Prepaid)', meterType: 'prepaid', category: 'ELECTRICITY' },
    { code: 'ibadan_electric_prepaid', name: 'Ibadan Electric (Prepaid)', meterType: 'prepaid', category: 'ELECTRICITY' },
    { code: 'enugu_electric_prepaid', name: 'Enugu Electric (Prepaid)', meterType: 'prepaid', category: 'ELECTRICITY' },
    { code: 'jos_electric_prepaid', name: 'Jos Electric (Prepaid)', meterType: 'prepaid', category: 'ELECTRICITY' },
    { code: 'kano_electric_prepaid', name: 'Kano Electric (Prepaid)', meterType: 'prepaid', category: 'ELECTRICITY' },
    { code: 'portharcourt_electric_prepaid', name: 'Port Harcourt (Prepaid)', meterType: 'prepaid', category: 'ELECTRICITY' },
  ];
};

// -----------------------------------------------------------------------------
// CORE FUNCTIONS
// -----------------------------------------------------------------------------

/**
 * STEP 1: Validate Meter
 * Monnify expects:
 *  - productCode
 *  - customerId
 */
const validateMeter = async (meterNumber, providerCode, meterType = 'prepaid') => {
  try {
    const m = String(meterNumber || '').trim();
    const p = String(providerCode || '').trim();
    const t = String(meterType || 'prepaid').trim();

    if (!m) throw new HttpError(400, 'Meter number is required');
    if (!p) throw new HttpError(400, 'Disco / product code is required');

    const token = await getAccessToken();
    const productCode = resolveProductCode(p, t);
    if (!productCode) throw new HttpError(400, 'Unable to resolve productCode');

    logger.info(`[Monnify][VALIDATE] meter=${m} providerCode=${p} productCode=${productCode}`);

    const response = await monnifyHttp.post(
      '/api/v1/vas/bills-payment/validate-customer',
      {
        productCode,
        customerId: m,
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    const { status, data } = response;

    logger.info(
      `[Monnify][VALIDATE] status=${status} requestSuccessful=${!!data?.requestSuccessful} message=${data?.responseMessage || 'n/a'}`
    );

    if (data?.requestSuccessful) {
      const body = data.responseBody || {};
      const vendInstruction = body.vendInstruction || {};

      return {
        isValid: true,
        name: body.name || body.customerName || 'Customer',
        address: body.address || 'Address Not Provided',
        meterNumber: m,
        providerCode: p,
        productCode,
        validationReference:
          body.validationReference || vendInstruction.validationReference || null,
        requireValidationRef: !!vendInstruction.requireValidationRef,
      };
    }

    throw new Error(data?.responseMessage || 'Meter validation failed');
  } catch (err) {
    if (err instanceof HttpError) throw err;

    const msg =
      err?.response?.data?.responseMessage ||
      err?.response?.data?.message ||
      err.message;

    logger.error(`[Monnify][VALIDATE][FAIL] ${msg}`);
    throw new HttpError(400, `Validation Failed: ${msg}`);
  }
};

/**
 * STEP 2: Create Pending Order (before payment)
 */
const createPendingOrder = async (userId, data = {}) => {
  const {
    meterNumber,
    discoCode, // can be disco shorthand OR monnify product code
    amount,
    phone,
    email,
    meterName,
    meterType,
    validationReference,
  } = data;

  const m = String(meterNumber || '').trim();
  const p = String(discoCode || '').trim();
  const t = String(meterType || 'prepaid').trim();
  const electricityAmount = parseFloat(amount);

  if (!m) throw new HttpError(400, 'Meter number is required');
  if (!p) throw new HttpError(400, 'Disco / product code is required');
  if (!Number.isFinite(electricityAmount) || electricityAmount <= 0) {
    throw new HttpError(400, 'Invalid amount');
  }

  const totalPayable = electricityAmount + CONVENIENCE_FEE;
  const productCode = resolveProductCode(p, t);
  if (!productCode) throw new HttpError(400, 'Unable to resolve productCode');

  logger.info(
    `[POWER][ORDER] create meter=${m} providerCode=${p} productCode=${productCode} amount=${electricityAmount}`
  );

  const order = await orderService.placeOrder({
    user: { id: userId },
    body: {
      type: 'POWER',
      orderItems: [],
      totalAmount: totalPayable,
      subTotal: electricityAmount,
      serviceFee: CONVENIENCE_FEE,
      deliveryFee: 0,
      status: 'Pending Payment',
      paymentStatus: 'Pending',
      metadata: {
        meterNumber: m,
        providerCode: p,
        productCode,
        meterType: t,
        meterName: meterName || null,
        phone: phone || null,
        email: email || null,
        validationReference: validationReference || null,
      },
    },
  });

  return order;
};

/**
 * STEP 3: Vend Power (called after payment confirmation)
 */
const vendPower = async (orderId) => {
  logger.info(`[Monnify][VEND] start orderId=${orderId}`);

  const order = await orderService.getOrder(orderId);
  if (!order) throw new Error('Order not found');

  // Idempotency
  if (String(order.status).toUpperCase() === 'DELIVERED') {
    return { success: true, token: order.metadata.get('token'), cached: true };
  }

  try {
    const token = await getAccessToken();
    const vendReference = `${Date.now()}-${uuidv4().slice(0, 6)}`;

    const productCode = order.metadata.get('productCode');
    const meterNumber = order.metadata.get('meterNumber');
    const validationReference = order.metadata.get('validationReference');

    if (!productCode || !meterNumber) {
      throw new Error('Missing productCode or meterNumber on order');
    }

    const payload = {
      productCode,
      customerId: meterNumber,
      vendAmount: Number(order.subTotal),
      vendReference,
    };

    if (validationReference) {
      payload.validationReference = validationReference;
    }

    logger.info(`[Monnify][VEND] payload=${JSON.stringify(payload)}`);

    const response = await monnifyHttp.post(
      '/api/v1/vas/bills-payment/vend',
      payload,
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: VEND_TIMEOUT,
      }
    );

    const { status, data } = response;

    logger.info(
      `[Monnify][VEND] status=${status} requestSuccessful=${!!data?.requestSuccessful} message=${data?.responseMessage || 'n/a'}`
    );

    if (!data?.requestSuccessful) {
      throw new Error(data?.responseMessage || 'Vending failed');
    }

    const body = data.responseBody || {};
    const tokenCode =
      body.token || body.pin || body.standardToken || 'TOKEN_GENERATED';

    const units = body.units || body.purchasedUnits || '0';

    await orderService.updateOrderStatus(
      orderId,
      'Delivered',
      {
        token: tokenCode,
        units,
        vendReference,
        vendorReference: body.transactionReference || null,
        vendorResponse: JSON.stringify(body),
      },
      'system'
    );

    try {
      await notificationService.createAndSendNotification(
        order.user?._id || order.user,
        'Power Token Generated',
        `Token: ${tokenCode}`,
        { type: 'POWER_ORDER', orderId, token: tokenCode }
      );
    } catch (_) {
      // ignore notification failures
    }

    return { success: true, token: tokenCode, units };
  } catch (err) {
    const msg =
      err?.response?.data?.responseMessage ||
      err?.response?.data?.message ||
      err.message;

    logger.error(`[Monnify][VEND][FAIL] ${msg}`);

    await orderService.updateOrderStatus(
      orderId,
      'Vending Failed',
      { error: msg },
      'system'
    );

    throw err;
  }
};

module.exports = {
  getProductsCatalog,
  validateMeter,
  createPendingOrder,
  vendPower,
};
