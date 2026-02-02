// File: src/api/v1/utilities/power.service.js
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');
const orderService = require('../orders/order.service');
const notificationService = require('../../notifications/notification.service');

// Sandbox: https://sandbox.monnify.com
// Live: https://api.monnify.com
const BASE_URL = process.env.MONNIFY_BASE_URL || 'https://sandbox.monnify.com';
const API_KEY = process.env.MONNIFY_API_KEY;
const SECRET_KEY = process.env.MONNIFY_SECRET_KEY;

const CONVENIENCE_FEE = parseFloat(process.env.POWER_CONVENIENCE_FEE || '100');
const HTTP_TIMEOUT = 30000;

// ---- Helpers ----

const safeJson = (v) => {
  try { return JSON.stringify(v); } catch (_) { return String(v); }
};

const monnifyClient = axios.create({
  baseURL: BASE_URL,
  timeout: HTTP_TIMEOUT,
  validateStatus: () => true, // do not throw on 4xx/5xx
});

const getAccessToken = async () => {
  logger.info('[Monnify] Authenticating...');

  if (!API_KEY || !SECRET_KEY) {
    logger.error('[Monnify] Missing MONNIFY_API_KEY or MONNIFY_SECRET_KEY in env');
    throw new HttpError(500, 'Monnify credentials missing on server. Check Render env vars.');
  }

  const authString = Buffer.from(`${API_KEY}:${SECRET_KEY}`).toString('base64');
  const resp = await monnifyClient.post(
    '/api/v1/auth/login',
    {},
    { headers: { Authorization: `Basic ${authString}` } }
  );

  const body = resp.data;

  if (resp.status >= 200 && resp.status < 300 && body?.requestSuccessful && body?.responseBody?.accessToken) {
    logger.info('[Monnify] Auth Successful.');
    return body.responseBody.accessToken;
  }

  // Log details so Render logs show the real failure
  logger.error(`[Monnify] Auth Failed: status=${resp.status} body=${safeJson(body)}`);

  const reason =
    body?.responseMessage ||
    body?.error ||
    'Authentication failed. Confirm sandbox/live keys and MONNIFY_BASE_URL';

  throw new HttpError(502, `Monnify authentication failed: ${reason}`);
};

/**
 * Backward-compatible fallback mapping (ONLY used if UI hasn't switched to real productCode yet).
 * If you enable catalog discovery and use real Monnify productCode, you can stop using this.
 */
const mapDiscoToFallbackProductCode = (code, meterType = 'prepaid') => {
  const isPrepaid = meterType.toLowerCase().includes('prepaid');

  const map = {
    'ikeja_electric_prepaid': 'MOB_PREPAID_IKEJA',
    'eko_electric_prepaid': 'MOB_PREPAID_EKO',
    'abuja_electric_prepaid': 'MOB_PREPAID_ABUJA',
    'ibadan_electric_prepaid': 'MOB_PREPAID_IBADAN',
    'enugu_electric_prepaid': 'MOB_PREPAID_ENUGU',
    'jos_electric_prepaid': 'MOB_PREPAID_JOS',
    'kano_electric_prepaid': 'MOB_PREPAID_KANO',
    'portharcourt_electric_prepaid': 'MOB_PREPAID_PH',

    // “generic” shortcuts
    'ikeja_electric': isPrepaid ? 'MOB_PREPAID_IKEJA' : 'MOB_POSTPAID_IKEJA',
    'eko_electric': isPrepaid ? 'MOB_PREPAID_EKO' : 'MOB_POSTPAID_EKO',
  };

  return map[code] || 'MOB_PREPAID_IKEJA';
};

const looksLikeProductCode = (v) => {
  // Real product codes could be many formats; keep this permissive.
  // If UI supplies productCode from catalog discovery, we treat it as productCode.
  return typeof v === 'string' && v.trim().length >= 3 && !v.includes(' ');
};

// ---- Catalog (for UI dropdown) ----

/**
 * Attempts Monnify discovery workflow.
 * If Monnify discovery endpoints are unavailable/disabled, returns a safe fallback list.
 *
 * NOTE:
 * Monnify docs recommend discovery → validate → vend workflow. :contentReference[oaicite:7]{index=7}
 * Bills Payment may require activation on your merchant. :contentReference[oaicite:8]{index=8}
 */
const getProductsCatalog = async ({ category = 'ELECTRICITY' } = {}) => {
  // Fallback list (still helpful even if Monnify discovery isn't enabled yet)
  const fallback = {
    category,
    items: [
      { code: 'ikeja_electric_prepaid', name: 'Ikeja Electric (Prepaid)' },
      { code: 'eko_electric_prepaid', name: 'Eko Electric (Prepaid)' },
      { code: 'abuja_electric_prepaid', name: 'Abuja Electric (Prepaid)' },
      { code: 'ibadan_electric_prepaid', name: 'Ibadan Electric (Prepaid)' },
      { code: 'enugu_electric_prepaid', name: 'Enugu Electric (Prepaid)' },
      { code: 'jos_electric_prepaid', name: 'Jos Electric (Prepaid)' },
      { code: 'kano_electric_prepaid', name: 'Kano Electric (Prepaid)' },
      { code: 'portharcourt_electric_prepaid', name: 'Port Harcourt (Prepaid)' },
    ],
    source: 'fallback',
  };

  // If you later confirm Monnify discovery endpoints and want to wire them,
  // you can replace this section with real calls:
  //   GET /api/v1/vas/bills-payment/categories
  //   GET /api/v1/vas/bills-payment/billers?categoryCode=...
  //   GET /api/v1/vas/bills-payment/products?billerCode=...
  //
  // For now: keep fallback to avoid breaking UI.
  return fallback;
};

// ---- Core: Validate Meter ----

const validateMeter = async (meterNumber, providerCode, meterType = 'prepaid') => {
  try {
    const token = await getAccessToken();

    // If providerCode is a real Monnify productCode use it.
    // Else use fallback mapping.
    const productCode = looksLikeProductCode(providerCode)
      ? providerCode
      : mapDiscoToFallbackProductCode(providerCode, meterType);

    logger.info(`[Monnify] Validating Meter: ${meterNumber} on productCode=${productCode}`);

    const resp = await monnifyClient.post(
      '/api/v1/vas/bills-payment/validate-customer',
      {
        productCode,
        customerId: meterNumber, // ✅ Monnify requires customerId :contentReference[oaicite:9]{index=9}
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    const body = resp.data;

    if (body?.requestSuccessful) {
      const data = body.responseBody || {};
      const vendInstruction = data.vendInstruction || {};
      const requireValidationRef = !!vendInstruction.requireValidationRef;

      return {
        isValid: true,
        productCode,
        customerId: meterNumber,
        name: data.name || data.customerName || 'Customer',
        address: data.address || 'Address Not Provided',
        requireValidationRef,
        validationReference: data.validationReference || vendInstruction.validationReference,
        raw: data,
      };
    }

    const msg = body?.responseMessage || body?.error || 'Meter validation failed';
    logger.warn(`[Monnify] Validation failed: status=${resp.status} msg=${msg} body=${safeJson(body)}`);
    throw new HttpError(400, `Validation Failed: ${msg}`);
  } catch (err) {
    // Preserve HttpError
    if (err instanceof HttpError) throw err;

    const msg = err?.message || 'Unknown error';
    logger.error(`[Monnify] Validation Exception: ${msg}`);
    throw new HttpError(400, `Validation Failed: ${msg}`);
  }
};

// ---- Core: Create Pending Order ----

const createPendingOrder = async (userId, data) => {
  const { meterNumber, discoCode, amount, phone, meterName, meterType } = data;

  const electricityAmount = parseFloat(amount);
  if (!Number.isFinite(electricityAmount) || electricityAmount <= 0) {
    throw new HttpError(400, 'Invalid amount');
  }

  const totalPayable = electricityAmount + CONVENIENCE_FEE;

  const providerCode = discoCode; // can be fallback discoCode OR real productCode
  const productCode = looksLikeProductCode(providerCode)
    ? providerCode
    : mapDiscoToFallbackProductCode(providerCode, meterType || 'prepaid');

  const newOrder = await orderService.placeOrder({
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
        meterNumber,
        discoCode: providerCode,
        productCode,
        meterType: meterType || 'prepaid',
        meterName,
        phone,
        // email is optional; keep whatever you already do elsewhere
      },
    },
  });

  return newOrder;
};

// ---- Core: Vend Token (called by webhook after payment success) ----

const vendPower = async (orderId) => {
  logger.info(`[Monnify] Vending Power for Order: ${orderId}`);

  const order = await orderService.getOrder(orderId);
  if (!order) throw new Error('Order not found');

  // Idempotency
  if (['Completed', 'Delivered'].includes(order.status)) {
    return { success: true, token: order.metadata?.get?.('token'), cached: true };
  }

  try {
    const token = await getAccessToken();

    const productCode = order.metadata.get('productCode');
    const meterNumber = order.metadata.get('meterNumber');
    const vendAmount = order.subTotal; // electricity amount (NOT total incl fee)
    const vendReference = `${orderId}-${uuidv4().substring(0, 8)}`;

    if (!productCode || !meterNumber) throw new Error('Missing productCode/meterNumber on order metadata');

    // 1) Validate first (to get validationReference + requireValidationRef)
    const validation = await validateMeter(meterNumber, productCode, order.metadata.get('meterType') || 'prepaid');

    const payload = {
      productCode,
      customerId: meterNumber,
      vendAmount,          // ✅ required :contentReference[oaicite:10]{index=10}
      vendReference,       // ✅ required :contentReference[oaicite:11]{index=11}
    };

    // include validationReference ONLY if required
    if (validation.requireValidationRef && validation.validationReference) {
      payload.validationReference = validation.validationReference;
    }

    logger.info(`[Monnify] Vend payload: ${safeJson(payload)}`);

    const resp = await monnifyClient.post(
      '/api/v1/vas/bills-payment/vend',
      payload,
      { headers: { Authorization: `Bearer ${token}` }, timeout: 45000 }
    );

    const body = resp.data;

    if (!body?.requestSuccessful) {
      const msg = body?.responseMessage || body?.error || 'Monnify vending failed';
      logger.error(`[Monnify] Vend failed: status=${resp.status} msg=${msg} body=${safeJson(body)}`);

      await orderService.updateOrderStatus(orderId, 'Vending Failed', { error: msg }, 'system');
      throw new Error(msg);
    }

    const vendData = body.responseBody || {};
    const vendStatus = (vendData.vendStatus || '').toString().toUpperCase();

    // On SUCCESS, electricity typically returns token/pin/units depending on biller.
    const tokenCode = vendData.token || vendData.pin || vendData.standardToken || null;
    const units = vendData.units || null;

    // Persist whatever we got
    const metaUpdate = {
      vendStatus,
      transactionReference: vendData.transactionReference,
      vendReference: vendData.vendReference || vendReference,
      vendorResponse: safeJson(vendData),
    };

    if (tokenCode) metaUpdate.token = tokenCode;
    if (units) metaUpdate.units = units;

    if (vendStatus === 'SUCCESS' && tokenCode) {
      await orderService.updateOrderStatus(orderId, 'Completed', metaUpdate, 'system');

      // notify user (best effort)
      try {
        await notificationService.createAndSendNotification(
          order.user?._id || order.user,
          'Power Token Generated',
          `Token: ${tokenCode}`,
          { type: 'POWER_ORDER', orderId, token: tokenCode }
        );
      } catch (_) {}

      return { success: true, token: tokenCode, units, vendStatus };
    }

    // If not SUCCESS, mark as pending/in-progress; UI receipt screen will poll.
    await orderService.updateOrderStatus(orderId, 'Vending In Progress', metaUpdate, 'system');
    return { success: true, vendStatus, ...metaUpdate };
  } catch (error) {
    const failReason = error?.message || 'Unknown vending error';
    logger.error(`[Monnify] Vending Exception: ${failReason}`);

    await orderService.updateOrderStatus(orderId, 'Vending Failed', { error: failReason }, 'system');
    throw error;
  }
};

module.exports = {
  getProductsCatalog,
  validateMeter,
  createPendingOrder,
  vendPower,
};
