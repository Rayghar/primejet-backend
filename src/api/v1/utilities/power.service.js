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

// -----------------------------------------------------------------------------
// HELPERS
// -----------------------------------------------------------------------------

/**
 * Map frontend disco codes → Monnify product codes (fallback mode).
 * If you later move fully to catalog discovery, this can be bypassed.
 */
const mapDiscoToMonnifyCode = (code, type = 'prepaid') => {
  const isPrepaid = String(type).toLowerCase().includes('prepaid');

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

  return map[code] || 'MOB_PREPAID_IKEJA';
};

/**
 * ---------------------------------------------------------------------------
 * AUTHENTICATION (FULLY DIAGNOSTIC – NO GUESSING)
 * ---------------------------------------------------------------------------
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
      {
        headers: { Authorization: `Basic ${authString}` },
      }
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

    logger.error(
      `[Monnify][AUTH][FAIL] status=${status || 'n/a'} message=${providerMsg}`
    );

    throw new HttpError(
      502,
      `Service authentication failed: ${providerMsg}`
    );
  }
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
const validateMeter = async (meterNumber, discoCode, meterType = 'prepaid') => {
  try {
    const m = String(meterNumber || '').trim();
    const d = String(discoCode || '').trim();
    const t = String(meterType || 'prepaid').trim();

    if (!m) throw new HttpError(400, 'Meter number is required');
    if (!d) throw new HttpError(400, 'Disco / product code is required');

    const token = await getAccessToken();
    const productCode = mapDiscoToMonnifyCode(d, t);

    logger.info(
      `[Monnify][VALIDATE] meter=${m} productCode=${productCode}`
    );

    const response = await monnifyHttp.post(
      '/api/v1/vas/bills-payment/validate-customer',
      {
        productCode,
        customerId: m, // ✅ correct per Monnify Bills Payment spec
      },
      {
        headers: { Authorization: `Bearer ${token}` },
      }
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
        discoCode: d,
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
    discoCode,
    amount,
    phone,
    email,
    meterName,
    meterType,
    validationReference,
  } = data;

  const m = String(meterNumber || '').trim();
  const d = String(discoCode || '').trim();
  const t = String(meterType || 'prepaid').trim();
  const electricityAmount = parseFloat(amount);

  if (!m) throw new HttpError(400, 'Meter number is required');
  if (!d) throw new HttpError(400, 'Disco / product code is required');
  if (!Number.isFinite(electricityAmount) || electricityAmount <= 0) {
    throw new HttpError(400, 'Invalid amount');
  }

  const totalPayable = electricityAmount + CONVENIENCE_FEE;
  const productCode = mapDiscoToMonnifyCode(d, t);

  logger.info(
    `[POWER][ORDER] create meter=${m} productCode=${productCode} amount=${electricityAmount}`
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
        discoCode: d,
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
    } catch (_) {}

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
  validateMeter,
  createPendingOrder,
  vendPower,
};
