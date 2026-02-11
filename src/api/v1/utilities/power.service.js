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
 * ✅ Default electricity product codes (env override)
 * Monnify tenants differ; some do NOT expose products endpoint.
 * So we MUST be able to validate/vend with a default configured productCode.
 */
const DEFAULT_ELECTRICITY_PREPAID_PRODUCT_CODE =
  (process.env.MONNIFY_ELECTRICITY_PREPAID_PRODUCT_CODE || 'PREPAID_ELECTRICITY_01').trim();

const DEFAULT_ELECTRICITY_POSTPAID_PRODUCT_CODE =
  (process.env.MONNIFY_ELECTRICITY_POSTPAID_PRODUCT_CODE || 'POSTPAID_ELECTRICITY_01').trim();

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

const isMonnifyBillerCode = (code) => safeStr(code).toLowerCase().startsWith('biller-');

const looksLikeProductCode = (code) =>
  /^[A-Z0-9_]{6,}$/.test(safeStr(code)) && !safeStr(code).toLowerCase().includes('_electric_');

const isPrepaid = (s) => safeStr(s).toLowerCase().includes('prepaid') || safeStr(s).toLowerCase().includes('-pre');
const isPostpaid = (s) => safeStr(s).toLowerCase().includes('postpaid') || safeStr(s).toLowerCase().includes('-post');

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

function pickDefaultElectricityProductCode(meterTypeOrCode) {
  const s = safeStr(meterTypeOrCode).toLowerCase();
  if (isPostpaid(s)) return DEFAULT_ELECTRICITY_POSTPAID_PRODUCT_CODE;
  return DEFAULT_ELECTRICITY_PREPAID_PRODUCT_CODE;
}

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
 * Resolve legacy provider code (eko_electric_prepaid etc) to billerCode + productCode.
 * ✅ IMPORTANT CHANGE:
 * - If products endpoint is not available, we FALLBACK to default product code(s)
 *   instead of throwing and breaking validation.
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
    throw new Error(`No biller found for ${p}`);
  }

  const billerCode = getBillerCode(biller);
  if (!billerCode) throw new Error(`Resolved biller missing billerCode for providerCode=${p}`);

  // Some tenants include productCode on biller
  let productCode = safeStr(biller?.productCode || biller?.product_code);

  // If not present, TRY products endpoint; if not available, fallback to configured default
  if (!productCode) {
    try {
      const products = await listProductsForBiller(billerCode);

      const match = products.find((prod) => {
        const name = getProductName(prod).toLowerCase();
        const code = getProductCode(prod).toUpperCase();
        if (!code) return false;

        if (isPrepaid(mt) || isPrepaid(p) || isPrepaid(billerCode)) return name.includes('prepaid') || code.includes('PREPAID');
        if (isPostpaid(mt) || isPostpaid(p) || isPostpaid(billerCode)) return name.includes('postpaid') || code.includes('POSTPAID');
        return true;
      });

      productCode = getProductCode(match);
    } catch (e) {
      // ✅ The exact issue in your logs:
      // Products endpoint not available for this Monnify tenant.
      logger.warn(`[POWER_SERVICE] Products endpoint unavailable; falling back to default electricity productCode. reason=${e.message}`);
      productCode = pickDefaultElectricityProductCode(mt || p || billerCode);
    }
  }

  // Final fallback safety
  if (!productCode) {
    productCode = pickDefaultElectricityProductCode(mt || p || billerCode);
  }

  const resolved = { productCode, billerCode };
  _resolvedProductCache.set(key, { ...resolved, expiresAtMs: now() + RESOLVE_TTL_MS });
  return resolved;
}

/**
 * Validate Meter
 * Monnify validate-customer expects billerCode + productCode + customerId (customerIdentifier)
 */
async function validateMeter(meterNumber, providerOrBillerOrProductCode, meterType = 'prepaid') {
  const meter = safeStr(meterNumber);
  const incoming = safeStr(providerOrBillerOrProductCode);
  const mt = safeStr(meterType || 'prepaid');

  if (!meter || !incoming) {
    throw new HttpError(400, 'meterNumber and discoCode are required');
  }

  const token = await getAccessToken();

  let billerCode = null;
  let productCode = null;

  if (isMonnifyBillerCode(incoming)) {
    // ✅ Flutter sends biller codes from GET /power/billers
    billerCode = incoming;
    productCode = pickDefaultElectricityProductCode(mt || incoming);
  } else if (looksLikeProductCode(incoming)) {
    // If caller passes a productCode directly, we still need billerCode for validate-customer
    // (Monnify usually requires billerCode). Keep existing strictness.
    throw new HttpError(400, 'Validation Failed: billerCode is required (do not send productCode alone).');
  } else {
    // Legacy internal provider code: resolve via billers list
    const resolved = await resolveProductFromLegacy(incoming, mt);
    billerCode = resolved.billerCode;
    productCode = resolved.productCode;
  }

  if (!billerCode) {
    throw new HttpError(400, 'Validation Failed: Unable to resolve billerCode');
  }
  if (!productCode) {
    productCode = pickDefaultElectricityProductCode(mt || incoming || billerCode);
  }

  const resp = await httpPost(
    `${BASE_URL}/api/v1/vas/bills-payment/validate-customer`,
    {
      billerCode,
      productCode,
      customerId: meter,
      // Compatibility keys across tenants
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
 * ✅ Store billerCode + productCode even when products endpoint is unavailable.
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

  let billerCode = null;
  let productCode = null;

  if (isMonnifyBillerCode(discoCode)) {
    billerCode = discoCode;
    productCode = pickDefaultElectricityProductCode(mt || discoCode);
  } else {
    const resolved = await resolveProductFromLegacy(discoCode, mt);
    billerCode = resolved.billerCode;
    productCode = resolved.productCode;
  }

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
        productCode,
        billerCode,
        // Keep original provided code for traceability
        providerCode: discoCode,
        validationReference: payload.validationReference,
        meterName: payload.meterName,
      },
    },
  });
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

  if (existingToken) return { success: true, token: existingToken, cached: true };

  const token = await getAccessToken();
  const vendReference = `${Date.now()}-${uuidv4().slice(0, 6)}`;

  const billerCode = safeStr(meta.billerCode);
  const productCode = safeStr(meta.productCode) || pickDefaultElectricityProductCode(meta.meterType);
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

// Keep exported for compatibility, but may not work on all tenants.
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
