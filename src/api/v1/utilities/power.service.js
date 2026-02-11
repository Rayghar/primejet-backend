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

// Normalize vendor payload fields; billers we return to Flutter are shaped as:
// { code: 'biller-ekedc-pre', name: 'Eko Electricity Distribution Prepaid', ... }
const getBillerName = (b) => safeStr(b?.name || b?.billerName || b?.biller_name);
const getBillerCode = (b) => safeStr(b?.code || b?.billerCode || b?.biller_code);

// Product fields can vary by tenant
const getProductName = (p) => safeStr(p?.productName || p?.name || p?.product_name);
const getProductCode = (p) => safeStr(p?.productCode || p?.code || p?.product_code);

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
    `${BASE_URL}/api/v1/vas/bills-payment/billers?category_code=${encodeURIComponent(cat)}`,
    monnifyAuthHeaderBearer(token),
    HTTP_TIMEOUT
  );

  const body = resp?.data;
  if (!body?.requestSuccessful) {
    throw new Error(body?.responseMessage || 'Failed to fetch billers');
  }

  // Monnify can return array OR object containing content/list
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

async function listProductsForBiller(billerCode) {
  const bc = safeStr(billerCode);
  if (!bc) throw new Error('billerCode is required');

  const cached = _productsCache.get(bc);
  if (cached && cached.expiresAtMs > now()) return cached.data;

  const token = await getAccessToken();

  // Tenants vary. We’ll try a few patterns safely.
  const candidates = [
    `${BASE_URL}/api/v1/vas/bills-payment/billers/${encodeURIComponent(bc)}/products`,
    `${BASE_URL}/api/v1/vas/bills-payment/billers/products?biller_code=${encodeURIComponent(bc)}`,
    `${BASE_URL}/api/v1/vas/bills-payment/billers/products?billerCode=${encodeURIComponent(bc)}`,
  ];

  for (const url of candidates) {
    const resp = await httpGet(url, monnifyAuthHeaderBearer(token), HTTP_TIMEOUT);
    if (resp.status === 404) continue;

    const body = resp?.data;
    if (!body?.requestSuccessful) {
      throw new Error(body?.responseMessage || 'Failed to fetch products');
    }

    const list = Array.isArray(body?.responseBody)
      ? body.responseBody
      : Array.isArray(body?.responseBody?.content)
      ? body.responseBody.content
      : Array.isArray(body?.responseBody?.products)
      ? body.responseBody.products
      : [];

    _productsCache.set(bc, { expiresAtMs: now() + PRODUCTS_TTL_MS, data: list });
    return list;
  }

  throw new Error('Products endpoint not available for this Monnify tenant.');
}

/**
 * Resolve legacy provider code to Monnify product + biller
 * providerCode examples: eko_electric_prepaid, ikeja_electric_postpaid
 */
async function resolveProductFromLegacy(providerCode, meterType) {
  const p = safeStr(providerCode);
  const mt = safeStr(meterType || '');

  const key = `${p}|${mt.toLowerCase()}`;
  const cached = _resolvedProductCache.get(key);
  if (cached && cached.expiresAtMs > now()) return cached;

  const keyword = extractDiscoKeyword(p);
  if (!keyword) throw new Error(`Cannot resolve providerCode: ${p}`);

  const billers = await listBillers('ELECTRICITY');

  const biller = billers.find((b) => {
    const name = getBillerName(b).toLowerCase();
    const code = getBillerCode(b).toLowerCase();
    return name.includes(keyword) || code.includes(keyword);
  });

  if (!biller) {
    // NOTE: this exact error was in your logs; keep it explicit.
    throw new Error(`No biller found for ${p}`);
  }

  const billerCode = getBillerCode(biller);
  if (!billerCode) throw new Error(`Resolved biller missing billerCode for providerCode=${p}`);

  // Some tenants include productCode on the biller object
  let productCode = safeStr(biller?.productCode || biller?.product_code);

  if (!productCode) {
    const products = await listProductsForBiller(billerCode);

    const match = products.find((prod) => {
      const name = getProductName(prod).toLowerCase();
      const code = getProductCode(prod).toUpperCase();
      if (!code) return false;

      if (isPrepaid(mt) || isPrepaid(p)) return name.includes('prepaid') || code.includes('PREPAID');
      if (isPostpaid(mt) || isPostpaid(p)) return name.includes('postpaid') || code.includes('POSTPAID');
      return true;
    });

    productCode = getProductCode(match);
  }

  if (!productCode) throw new Error(`Unable to resolve productCode for ${p}`);

  const resolved = { productCode, billerCode };
  _resolvedProductCache.set(key, { ...resolved, expiresAtMs: now() + RESOLVE_TTL_MS });
  return resolved;
}

/**
 * Validate Meter
 * Monnify validate-customer expects billerCode + productCode + customerId (customerIdentifier)
 */
async function validateMeter(meterNumber, providerOrProductCode, meterType = 'prepaid') {
  const meter = safeStr(meterNumber);
  const provider = safeStr(providerOrProductCode);
  const mt = safeStr(meterType || 'prepaid');

  if (!meter || !provider) {
    throw new HttpError(400, 'meterNumber and discoCode are required');
  }

  const token = await getAccessToken();
  let productCode = null;
  let billerCode = null;

  if (looksLikeProductCode(provider)) {
    productCode = provider;
    // billerCode may still be required by tenant; if you pass productCode directly,
    // you must supply billerCode from UI/catalog. We don’t have it here, so we keep billerCode null.
  } else {
    const resolved = await resolveProductFromLegacy(provider, mt);
    productCode = resolved.productCode;
    billerCode = resolved.billerCode;
  }

  // If this tenant requires billerCode, ensure it's present (common for Monnify bills validate)
  if (!billerCode) {
    throw new HttpError(400, 'Validation Failed: Unable to resolve billerCode for provider');
  }

  const resp = await httpPost(
    `${BASE_URL}/api/v1/vas/bills-payment/validate-customer`,
    {
      billerCode,
      productCode,
      customerId: meter,
      // Keep for compatibility across tenants (harmless if ignored)
      customerKey: meter,
      customerIdentifier: meter,
    },
    monnifyAuthHeaderBearer(token),
    HTTP_TIMEOUT
  );

  const body = resp?.data;
  if (!body?.requestSuccessful) {
    throw new HttpError(400, body?.responseMessage || 'Meter validation failed');
  }

  return {
    isValid: true,
    name: body?.responseBody?.name || body?.responseBody?.customerName || 'Customer',
    address: body?.responseBody?.address || null,
    meterNumber: meter,
    productCode,
    billerCode,
    validationReference: body?.responseBody?.validationReference || null,
    raw: body?.responseBody,
  };
}

/**
 * Create Pending Order
 */
async function createPendingOrder(payload) {
  if (!payload?.userId) throw new HttpError(401, 'User required');

  const meterNumber = safeStr(payload.meterNumber);
  const discoCode = safeStr(payload.discoCode);
  const mt = safeStr(payload.meterType || 'prepaid');
  const amount = Number(payload.amount);

  if (!meterNumber) throw new HttpError(400, 'meterNumber is required');
  if (!discoCode) throw new HttpError(400, 'discoCode is required');
  if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, 'amount is invalid');

  const resolved = await resolveProductFromLegacy(discoCode, mt);

  return orderService.placeOrder({
    user: { id: payload.userId },
    body: {
      type: 'POWER',
      totalAmount: amount + CONVENIENCE_FEE,
      subTotal: amount,
      serviceFee: CONVENIENCE_FEE,
      status: 'Pending Payment',
      paymentStatus: 'Pending',
      metadata: {
        meterNumber,
        meterType: mt,
        phone: payload.phone,
        productCode: resolved.productCode,
        billerCode: resolved.billerCode,
        // Keep original provider code for traceability
        providerCode: discoCode,
        validationReference: payload.validationReference,
        meterName: payload.meterName,
      },
    },
  });
}

/**
 * Vend Power (Webhook-triggered)
 * Monnify vend typically expects: billerCode, productCode, customerId, vendAmount, vendReference (+ validationReference if any)
 */
async function vendPower(orderId) {
  const oid = safeStr(orderId);
  if (!oid) throw new Error('orderId is required');

  const order = await orderService.getOrder(oid, { id: 'system', role: 'admin' });
  if (!order) throw new Error('Order not found');

  const meta = order.metadata || {};
  const existingToken = meta?.token;

  // Idempotency: if already has token
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
    customerId: meterNumber,
    // keep for tenant compatibility
    customerKey: meterNumber,
    customerIdentifier: meterNumber,
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

  // Monnify/partners may return token with different keys
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
