// File: src/api/v1/utilities/power.service.js

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');
const orderService = require('../orders/order.service');

// Defensive import for notification service
let notificationService = null;
try {
  notificationService = require('../notifications/notification.service.js');
} catch (_) {
  try {
    notificationService = require('../../v1/notifications/notification.service.js');
  } catch (_e) {
    try {
      notificationService = require('../../notifications/notification.service');
    } catch (__e) {
      logger.warn('[POWER_SERVICE] notification.service not found. Notifications disabled.');
    }
  }
}

/**
 * Configuration
 */
const BASE_URL = process.env.MONNIFY_BASE_URL || 'https://sandbox.monnify.com';
const API_KEY = process.env.MONNIFY_API_KEY;
const SECRET_KEY = process.env.MONNIFY_SECRET_KEY;

const CONVENIENCE_FEE = parseFloat(process.env.POWER_CONVENIENCE_FEE || '100');

const HTTP_TIMEOUT = 50000;
const VEND_TIMEOUT = 60000;

/**
 * Caches
 */
let _authCache = { accessToken: null, expiresAtMs: 0 };
const _billersCache = new Map();          // category -> { expiresAtMs, data }
const _billerProductsCache = new Map();   // billerCode -> { expiresAtMs, data }
const _resolvedProductCache = new Map();  // key -> { expiresAtMs, billerCode, productCode }

const AUTH_TTL_MS = 55 * 60 * 1000;
const BILLERS_TTL_MS = 6 * 60 * 60 * 1000;
const BILLER_PRODUCTS_TTL_MS = 6 * 60 * 60 * 1000;
const RESOLVE_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Helpers
 */
const now = () => Date.now();
const safeStr = (v) => String(v ?? '').trim();

const isBillerCode = (s) => safeStr(s).toLowerCase().startsWith('biller-');

const isPrepaid = (s) => safeStr(s).toLowerCase().includes('prepaid');
const isPostpaid = (s) => safeStr(s).toLowerCase().includes('postpaid');

const extractDiscoKeyword = (providerCode) => {
  const c = safeStr(providerCode).toLowerCase();
  return [
    'eko',
    'ikeja',
    'abuja',
    'ibadan',
    'enugu',
    'jos',
    'kano',
    'portharcourt',
    'phedc',
    'ph',
    'aedc',
    'ikedc',
    'ekedc',
    'ibedc',
    'eedc',
    'jedc',
    'kedc',
    'kedco',
  ].find((k) => c.includes(k));
};

const getBillerName = (b) => safeStr(b?.name || b?.billerName || b?.biller_name);
const getBillerCode = (b) => safeStr(b?.code || b?.billerCode || b?.biller_code);

// From Monnify support example for biller-products:
// content[].code = product code, content[].biller.code = biller code
const getProductName = (p) => safeStr(p?.name || p?.productName || p?.product_name);
const getProductCode = (p) => safeStr(p?.code || p?.productCode || p?.product_code);

const monnifyAuthHeaderBasic = () => ({
  Authorization: `Basic ${Buffer.from(`${API_KEY}:${SECRET_KEY}`).toString('base64')}`,
});

const monnifyAuthHeaderBearer = (token) => ({
  Authorization: `Bearer ${token}`,
});

const httpPost = (url, data, headers, timeout) =>
  axios.post(url, data, { headers, timeout, validateStatus: () => true });

const httpGet = (url, headers, timeout) =>
  axios.get(url, { headers, timeout, validateStatus: () => true });

/**
 * Auth
 */
async function getAccessToken() {
  if (_authCache.accessToken && _authCache.expiresAtMs > now()) {
    return _authCache.accessToken;
  }

  if (!API_KEY || !SECRET_KEY) {
    throw new Error('Monnify API credentials missing');
  }

  const resp = await httpPost(
    `${BASE_URL}/api/v1/auth/login`,
    {},
    monnifyAuthHeaderBasic(),
    HTTP_TIMEOUT
  );

  const body = resp?.data;
  if (!body?.requestSuccessful || !body?.responseBody?.accessToken) {
    throw new Error(body?.responseMessage || 'Monnify auth failed');
  }

  _authCache.accessToken = body.responseBody.accessToken;
  _authCache.expiresAtMs = now() + AUTH_TTL_MS;

  return _authCache.accessToken;
}

/**
 * Billers
 */
async function listBillers(category = 'ELECTRICITY') {
  const cat = safeStr(category).toUpperCase();
  const cached = _billersCache.get(cat);
  if (cached && cached.expiresAtMs > now()) return cached.data;

  const token = await getAccessToken();

  const resp = await httpGet(
    `${BASE_URL}/api/v1/vas/bills-payment/billers?category_code=${encodeURIComponent(cat)}`,
    monnifyAuthHeaderBearer(token),
    HTTP_TIMEOUT
  );

  const body = resp?.data;
  if (!body?.requestSuccessful) {
    throw new Error(body?.responseMessage || 'Failed to fetch billers');
  }

  const list = Array.isArray(body?.responseBody)
    ? body.responseBody
    : Array.isArray(body?.responseBody?.content)
    ? body.responseBody.content
    : Array.isArray(body?.responseBody?.billers)
    ? body.responseBody.billers
    : [];

  _billersCache.set(cat, { expiresAtMs: now() + BILLERS_TTL_MS, data: list });
  return list;
}

/**
 * ✅ Monnify-supported endpoint (per support):
 * GET /api/v1/vas/bills-payment/biller-products?biller_code=biller-phedc-pre
 */
async function listBillerProducts(billerCode) {
  const bc = safeStr(billerCode);
  if (!bc) throw new Error('billerCode is required');

  const cached = _billerProductsCache.get(bc);
  if (cached && cached.expiresAtMs > now()) return cached.data;

  const token = await getAccessToken();

  const url = `${BASE_URL}/api/v1/vas/bills-payment/biller-products?biller_code=${encodeURIComponent(bc)}`;
  const resp = await httpGet(url, monnifyAuthHeaderBearer(token), HTTP_TIMEOUT);

  const body = resp?.data;
  if (!body?.requestSuccessful) {
    throw new Error(body?.responseMessage || 'Failed to fetch biller products');
  }

  const content =
    Array.isArray(body?.responseBody?.content) ? body.responseBody.content : [];

  _billerProductsCache.set(bc, { expiresAtMs: now() + BILLER_PRODUCTS_TTL_MS, data: content });
  return content;
}

/**
 * Resolve input code into { billerCode, productCode }.
 * Supports:
 *  - Monnify biller codes: biller-ekedc-pre (preferred)
 *  - Legacy/internal codes: eko_electric_prepaid (fallback)
 */
async function resolveBillerAndProduct(inputCode, meterType) {
  const raw = safeStr(inputCode);
  const mt = safeStr(meterType || '');

  const cacheKey = `${raw}|${mt.toLowerCase()}`;
  const cached = _resolvedProductCache.get(cacheKey);
  if (cached && cached.expiresAtMs > now()) return cached;

  let billerCode = null;

  // Case A: already a Monnify biller code (Flutter sends this)
  if (isBillerCode(raw)) {
    billerCode = raw;
  } else {
    // Case B: legacy/internal string — find matching biller
    const keyword = extractDiscoKeyword(raw);
    if (!keyword) throw new Error(`Cannot resolve providerCode: ${raw}`);

    const billers = await listBillers('ELECTRICITY');
    const matchedBiller = billers.find((b) => {
      const name = getBillerName(b).toLowerCase();
      const code = getBillerCode(b).toLowerCase();
      return name.includes(keyword) || code.includes(keyword);
    });

    if (!matchedBiller) {
      throw new Error(`No biller found for ${raw}`);
    }

    billerCode = getBillerCode(matchedBiller);
  }

  if (!billerCode) throw new Error('Unable to resolve billerCode');

  // Fetch biller-products for that billerCode (Monnify support endpoint)
  const products = await listBillerProducts(billerCode);
  if (!products.length) {
    throw new Error('Biller product not supported');
  }

  // Choose product by prepaid/postpaid hint (if there are multiple)
  const pick = products.find((p) => {
    const name = getProductName(p).toLowerCase();
    const code = getProductCode(p).toLowerCase();

    if (isPrepaid(mt) || isPrepaid(raw)) return name.includes('prepaid') || code.includes('pre');
    if (isPostpaid(mt) || isPostpaid(raw)) return name.includes('postpaid') || code.includes('post');
    return true;
  }) || products[0];

  const productCode = getProductCode(pick);
  if (!productCode) throw new Error('Unable to resolve productCode');

  const resolved = { billerCode, productCode };
  _resolvedProductCache.set(cacheKey, { ...resolved, expiresAtMs: now() + RESOLVE_TTL_MS });
  return resolved;
}

/**
 * Validate Meter
 * Uses Monnify validate-customer with billerCode + productCode
 */
async function validateMeter(meterNumber, discoOrBillerCode, meterType = 'prepaid') {
  const meter = safeStr(meterNumber);
  const disco = safeStr(discoOrBillerCode);
  const mt = safeStr(meterType || 'prepaid');

  if (!meter || !disco) {
    throw new HttpError(400, 'meterNumber and discoCode are required');
  }

  const token = await getAccessToken();

  const { billerCode, productCode } = await resolveBillerAndProduct(disco, mt);

  const resp = await httpPost(
    `${BASE_URL}/api/v1/vas/bills-payment/validate-customer`,
    {
      billerCode,
      productCode,
      customerIdentifier: meter,
      // compatibility fields
      customerId: meter,
      customerKey: meter,
    },
    monnifyAuthHeaderBearer(token),
    HTTP_TIMEOUT
  );

  const body = resp?.data;
  if (!body?.requestSuccessful) {
    throw new HttpError(400, body?.responseMessage || 'Meter validation failed');
  }

  const rb = body?.responseBody || {};

  return {
    isValid: true,
    name: rb?.name || rb?.customerName || 'Customer',
    address: rb?.address || null,
    meterNumber: meter,
    billerCode,
    productCode,
    validationReference: rb?.validationReference || null,
    raw: rb,
  };
}

/**
 * Create Pending Order
 * ✅ FIXED: use resolveBillerAndProduct (resolveProductFromLegacy does not exist here)
 * Stores resolved billerCode + productCode so vend does NOT guess later.
 */
async function createPendingOrder(payload) {
  if (!payload?.userId) {
    throw new HttpError(401, 'User required');
  }

  const meterNumber = safeStr(payload.meterNumber);
  const discoCode = safeStr(payload.discoCode);
  const meterType = safeStr(payload.meterType || 'prepaid');
  const amount = Number(payload.amount);

  if (!meterNumber || !discoCode) {
    throw new HttpError(400, 'meterNumber and discoCode are required');
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new HttpError(400, 'amount is invalid');
  }

  // ✅ Resolve using Monnify biller-products endpoint flow
  const resolved = await resolveBillerAndProduct(discoCode, meterType);

  // ✅ DO NOT CHANGE placeOrder signature (protect GAS)
  return orderService.placeOrder(
    payload.userId,
    {
      type: 'POWER',
      totalAmount: amount + CONVENIENCE_FEE,
      subTotal: amount,
      serviceFee: CONVENIENCE_FEE,
      status: 'Pending Payment',
      paymentStatus: 'Pending',
      metadata: {
        meterNumber,
        meterType,
        phone: payload.phone,
        productCode: resolved.productCode,
        billerCode: resolved.billerCode,
        providerCode: discoCode, // traceability
        validationReference: payload.validationReference,
        meterName: payload.meterName,
      },
    }
  );
}

/**
 * Vend Power (Webhook-triggered)
 */
async function vendPower(orderId) {
  const oid = safeStr(orderId);
  if (!oid) throw new Error('orderId is required');

  const order = await orderService.getOrder(oid, { id: 'system', role: 'admin' });
  if (!order) throw new Error('Order not found');

  const meta = order.metadata || {};
  const existingToken = meta?.token;

  // Idempotency
  if (existingToken) return { success: true, token: existingToken, cached: true };

  const token = await getAccessToken();
  const vendReference = `${Date.now()}-${uuidv4().slice(0, 6)}`;

  const productCode = safeStr(meta.productCode);
  const billerCode = safeStr(meta.billerCode);
  const meterNumber = safeStr(meta.meterNumber);
  const validationReference = safeStr(meta.validationReference);

  if (!billerCode) throw new Error('Missing billerCode on order metadata');
  if (!productCode) throw new Error('Missing productCode on order metadata');
  if (!meterNumber) throw new Error('Missing meterNumber on order metadata');

  const vendAmount = Number(order.subTotal);
  if (!Number.isFinite(vendAmount) || vendAmount <= 0) throw new Error('Invalid vend amount');

  const vendPayload = {
    billerCode,
    productCode,
    customerIdentifier: meterNumber,
    customerId: meterNumber,
    customerKey: meterNumber,
    vendAmount,
    vendReference,
  };

  if (validationReference) vendPayload.validationReference = validationReference;

  const resp = await httpPost(
    `${BASE_URL}/api/v1/vas/bills-payment/vend`,
    vendPayload,
    monnifyAuthHeaderBearer(token),
    VEND_TIMEOUT
  );

  const body = resp?.data;
  if (!body?.requestSuccessful) {
    try {
      await orderService.updateOrderStatus(oid, 'Vending Failed', { error: body }, 'system');
    } catch (_) {}
    throw new Error(body?.responseMessage || 'Vending failed');
  }

  const vendData = body.responseBody || {};

  const tokenValue =
    vendData.token ||
    vendData.pin ||
    vendData.standardToken ||
    vendData.tokenCode ||
    vendData.tokenNo ||
    null;

  const units = vendData.units || vendData.unit || vendData.purchasedUnits || null;

  await orderService.updateOrderStatus(
    oid,
    'Delivered',
    {
      token: tokenValue,
      units,
      vendReference,
      vendorReference: vendData.transactionReference || vendData.reference || null,
      vendorResponse: vendData,
    },
    'system'
  );

  try {
    if (notificationService?.createAndSendNotification) {
      await notificationService.createAndSendNotification(
        order.user,
        'Power Token Generated',
        tokenValue ? `Token: ${tokenValue}` : 'Your electricity purchase was successful.',
        { orderId: oid, token: tokenValue }
      );
    }
  } catch (_) {}

  return { success: true, token: tokenValue, units };
}

/**
 * Public APIs
 */
const getElectricityBillers = (category) => listBillers(category);
const getBillerProducts = (billerCode) => listBillerProducts(billerCode);
const retryVending = (orderId) => vendPower(orderId);

module.exports = {
  validateMeter,
  createPendingOrder,
  vendPower,
  getElectricityBillers,
  getBillerProducts,
  retryVending,
};
