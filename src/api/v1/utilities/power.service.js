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
const _billersCache = new Map();
const _productsCache = new Map();
const _resolvedProductCache = new Map();

const AUTH_TTL_MS = 55 * 60 * 1000;
const BILLERS_TTL_MS = 6 * 60 * 60 * 1000;
const PRODUCTS_TTL_MS = 6 * 60 * 60 * 1000;
const RESOLVE_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Helpers
 */
const now = () => Date.now();
const safeStr = (v) => String(v ?? '').trim();

const looksLikeProductCode = (code) =>
  /^[A-Z0-9_]{6,}$/.test(safeStr(code)) && !safeStr(code).includes('_electric_');

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
    'ph',
  ].find((k) => c.includes(k));
};

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
 * Billers & Products
 */
async function listBillers(category = 'ELECTRICITY') {
  const cat = safeStr(category).toUpperCase();
  const cached = _billersCache.get(cat);
  if (cached && cached.expiresAtMs > now()) return cached.data;

  const token = await getAccessToken();
  const resp = await httpGet(
    `${BASE_URL}/api/v1/vas/bills-payment/billers?category_code=${cat}`,
    monnifyAuthHeaderBearer(token),
    HTTP_TIMEOUT
  );

  const body = resp?.data;
  if (!body?.requestSuccessful) {
    throw new Error(body?.responseMessage || 'Failed to fetch billers');
  }

  const list = Array.isArray(body.responseBody)
    ? body.responseBody
    : body.responseBody?.content || [];

  _billersCache.set(cat, { expiresAtMs: now() + BILLERS_TTL_MS, data: list });
  return list;
}

async function listProductsForBiller(billerCode) {
  const cached = _productsCache.get(billerCode);
  if (cached && cached.expiresAtMs > now()) return cached.data;

  const token = await getAccessToken();
  const url = `${BASE_URL}/api/v1/vas/bills-payment/billers/${billerCode}/products`;
  const resp = await httpGet(url, monnifyAuthHeaderBearer(token), HTTP_TIMEOUT);

  const body = resp?.data;
  if (!body?.requestSuccessful) {
    throw new Error(body?.responseMessage || 'Failed to fetch products');
  }

  const list = body.responseBody || [];
  _productsCache.set(billerCode, { expiresAtMs: now() + PRODUCTS_TTL_MS, data: list });
  return list;
}

/**
 * Resolve legacy provider code to Monnify product
 */
async function resolveProductFromLegacy(providerCode, meterType) {
  const key = `${providerCode}|${meterType}`;
  const cached = _resolvedProductCache.get(key);
  if (cached && cached.expiresAtMs > now()) return cached;

  const keyword = extractDiscoKeyword(providerCode);
  if (!keyword) throw new Error(`Cannot resolve providerCode: ${providerCode}`);

  const billers = await listBillers('ELECTRICITY');
  const biller = billers.find(
    (b) =>
      safeStr(b.billerName).toLowerCase().includes(keyword) ||
      safeStr(b.billerCode).toLowerCase().includes(keyword)
  );

  if (!biller) throw new Error(`No biller found for ${providerCode}`);

  let productCode = biller.productCode;
  if (!productCode) {
    const products = await listProductsForBiller(biller.billerCode);
    const match = products.find((p) =>
      isPrepaid(meterType)
        ? safeStr(p.productName).toLowerCase().includes('prepaid')
        : isPostpaid(meterType)
        ? safeStr(p.productName).toLowerCase().includes('postpaid')
        : true
    );
    productCode = match?.productCode;
  }

  if (!productCode) throw new Error('Unable to resolve productCode');

  const resolved = { productCode, billerCode: biller.billerCode };
  _resolvedProductCache.set(key, { ...resolved, expiresAtMs: now() + RESOLVE_TTL_MS });
  return resolved;
}

/**
 * Validate Meter
 */
async function validateMeter(meterNumber, providerOrProductCode, meterType = 'prepaid') {
  if (!meterNumber || !providerOrProductCode) {
    throw new HttpError(400, 'meterNumber and discoCode are required');
  }

  const token = await getAccessToken();
  let productCode, billerCode;

  if (looksLikeProductCode(providerOrProductCode)) {
    productCode = providerOrProductCode;
  } else {
    const resolved = await resolveProductFromLegacy(providerOrProductCode, meterType);
    productCode = resolved.productCode;
    billerCode = resolved.billerCode;
  }

  const resp = await httpPost(
    `${BASE_URL}/api/v1/vas/bills-payment/validate-customer`,
    { productCode, customerId: meterNumber, customerKey: meterNumber },
    monnifyAuthHeaderBearer(token),
    HTTP_TIMEOUT
  );

  const body = resp?.data;
  if (!body?.requestSuccessful) {
    throw new HttpError(400, body?.responseMessage || 'Meter validation failed');
  }

  return {
    isValid: true,
    name: body.responseBody?.name || 'Customer',
    meterNumber,
    productCode,
    billerCode,
    validationReference: body.responseBody?.validationReference || null,
    raw: body.responseBody,
  };
}

/**
 * Create Pending Order
 */
async function createPendingOrder(payload) {
  if (!payload.userId) throw new HttpError(401, 'User required');

  const resolved = await resolveProductFromLegacy(payload.discoCode, payload.meterType);

  return orderService.placeOrder({
    user: { id: payload.userId },
    body: {
      type: 'POWER',
      totalAmount: payload.amount + CONVENIENCE_FEE,
      subTotal: payload.amount,
      serviceFee: CONVENIENCE_FEE,
      status: 'Pending Payment',
      paymentStatus: 'Pending',
      metadata: {
        meterNumber: payload.meterNumber,
        meterType: payload.meterType,
        phone: payload.phone,
        productCode: resolved.productCode,
        billerCode: resolved.billerCode,
        validationReference: payload.validationReference,
      },
    },
  });
}

/**
 * Vend Power (Webhook-triggered)
 */
async function vendPower(orderId) {
  const order = await orderService.getOrder(orderId, { id: 'system', role: 'admin' });
  const meta = order.metadata;

  const existingToken = meta?.token;
  if (existingToken) return { success: true, token: existingToken, cached: true };

  const token = await getAccessToken();
  const vendReference = `${Date.now()}-${uuidv4().slice(0, 6)}`;

  const resp = await httpPost(
    `${BASE_URL}/api/v1/vas/bills-payment/vend`,
    {
      productCode: meta.productCode,
      customerId: meta.meterNumber,
      customerKey: meta.meterNumber,
      vendAmount: order.subTotal,
      vendReference,
      validationReference: meta.validationReference,
    },
    monnifyAuthHeaderBearer(token),
    VEND_TIMEOUT
  );

  const body = resp?.data;
  if (!body?.requestSuccessful) {
    await orderService.updateOrderStatus(orderId, 'Vending Failed', { error: body });
    throw new Error(body?.responseMessage || 'Vending failed');
  }

  const vendData = body.responseBody;

  await orderService.updateOrderStatus(orderId, 'Delivered', {
    token: vendData.token,
    units: vendData.units,
    vendReference,
    vendorResponse: vendData,
  });

  try {
    if (notificationService?.createAndSendNotification) {
      await notificationService.createAndSendNotification(
        order.user,
        'Power Token Generated',
        `Token: ${vendData.token}`,
        { orderId }
      );
    }
  } catch (_) {}

  return { success: true, token: vendData.token };
}

/**
 * Public APIs
 */
const getElectricityBillers = (category) => listBillers(category);
const getBillerProducts = (billerCode) => listProductsForBiller(billerCode);
const retryVending = (orderId) => vendPower(orderId);

module.exports = {
  validateMeter,
  createPendingOrder,
  vendPower,
  getElectricityBillers,
  getBillerProducts,
  retryVending,
};
