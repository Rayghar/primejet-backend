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
 * BASE_URL:
 * - Sandbox: https://sandbox.monnify.com
 * - Live:    https://api.monnify.com
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
const _billersCache = new Map();          // key: category -> { expiresAtMs, data }
const _billerProductsCache = new Map();   // key: category -> { expiresAtMs, data }
const _resolvedCache = new Map();         // key: discoCode|meterType -> { expiresAtMs, billerCode, productCode }

const AUTH_TTL_MS = 55 * 60 * 1000;
const BILLERS_TTL_MS = 6 * 60 * 60 * 1000;
const BILLER_PRODUCTS_TTL_MS = 6 * 60 * 60 * 1000;
const RESOLVE_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Helpers
 */
const now = () => Date.now();
const safeStr = (v) => String(v ?? '').trim();
const lower = (v) => safeStr(v).toLowerCase();
const upper = (v) => safeStr(v).toUpperCase();

const isPrepaid = (s) => lower(s).includes('prepaid') || lower(s).includes('-pre');
const isPostpaid = (s) => lower(s).includes('postpaid') || lower(s).includes('-post');

const extractDiscoKeyword = (providerCode) => {
  const c = lower(providerCode);
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
    // also match Monnify biller codes like ekedc/ikedc
    'ekedc',
    'ikedc',
    'ibedc',
    'phedc',
    'aedc',
    'eedc',
    'jedc',
    'kedc',
    'kedco',
  ].find((k) => c.includes(k)) || null;
};

// billers returned to Flutter are shaped as { code, name, categories }
const getBillerName = (b) => safeStr(b?.name || b?.billerName || b?.biller_name);
const getBillerCode = (b) => safeStr(b?.code || b?.billerCode || b?.biller_code);

// biller-products fields can vary by tenant
const getBPBillerCode = (x) => safeStr(x?.billerCode || x?.biller_code || x?.biller?.code || x?.biller?.billerCode);
const getBPProductCode = (x) => safeStr(x?.productCode || x?.product_code || x?.code);
const getBPProductName = (x) => safeStr(x?.productName || x?.product_name || x?.name);

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
 * Docs: you list billers filtered by categoryCode. :contentReference[oaicite:1]{index=1}
 */
async function listBillers(category = 'ELECTRICITY') {
  const cat = upper(category || 'ELECTRICITY');

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
 * Biller Products
 * ✅ Monnify Support confirmed your tenant should use:
 *   GET /api/v1/vas/bills-payment/biller-products
 *
 * We optionally filter by category_code if supported (harmless if ignored).
 */
async function listBillerProducts(category = 'ELECTRICITY') {
  const cat = upper(category || 'ELECTRICITY');

  const cached = _billerProductsCache.get(cat);
  if (cached && cached.expiresAtMs > now()) return cached.data;

  const token = await getAccessToken();

  // Try a couple safe variants (tenants differ)
  const candidates = [
    `${BASE_URL}/api/v1/vas/bills-payment/biller-products?category_code=${encodeURIComponent(cat)}`,
    `${BASE_URL}/api/v1/vas/bills-payment/biller-products?categoryCode=${encodeURIComponent(cat)}`,
    `${BASE_URL}/api/v1/vas/bills-payment/biller-products`,
  ];

  let lastErr = null;

  for (const url of candidates) {
    const resp = await httpGet(url, monnifyAuthHeaderBearer(token), HTTP_TIMEOUT);
    const body = resp?.data;

    if (resp.status === 404) {
      lastErr = new Error('biller-products endpoint not found on this base URL');
      continue;
    }

    if (!body?.requestSuccessful) {
      lastErr = new Error(body?.responseMessage || 'Failed to fetch biller products');
      continue;
    }

    const list = Array.isArray(body?.responseBody)
      ? body.responseBody
      : Array.isArray(body?.responseBody?.content)
      ? body.responseBody.content
      : Array.isArray(body?.responseBody?.products)
      ? body.responseBody.products
      : Array.isArray(body?.responseBody?.billerProducts)
      ? body.responseBody.billerProducts
      : [];

    _billerProductsCache.set(cat, { expiresAtMs: now() + BILLER_PRODUCTS_TTL_MS, data: list });
    return list;
  }

  throw lastErr || new Error('Unable to load biller products from Monnify');
}

/**
 * Resolve (billerCode, productCode) from either:
 * - discoCode = biller-ekedc-pre/post (preferred from UI)
 * - legacy provider codes like eko_electric_prepaid (fallback)
 */
async function resolveBillerAndProduct(discoCode, meterType = 'prepaid') {
  const disco = safeStr(discoCode);
  const mt = safeStr(meterType || '');
  const cacheKey = `${disco}|${lower(mt)}`;

  const cached = _resolvedCache.get(cacheKey);
  if (cached && cached.expiresAtMs > now()) return cached;

  // 1) If UI passes biller-* code, that is already the billerCode
  let billerCode = null;
  const discoLower = lower(disco);

  if (discoLower.startsWith('biller-')) {
    billerCode = disco;
  } else {
    // 2) Legacy fallback: find biller by keyword in billers list
    const keyword = extractDiscoKeyword(disco);
    if (!keyword) throw new Error(`Cannot resolve discoCode: ${disco}`);

    const billers = await listBillers('ELECTRICITY');
    const biller = billers.find((b) => {
      const name = lower(getBillerName(b));
      const code = lower(getBillerCode(b));
      return name.includes(keyword) || code.includes(keyword);
    });

    if (!biller) {
      throw new Error(`No biller found for ${disco}`);
    }

    billerCode = getBillerCode(biller);
  }

  if (!billerCode) throw new Error(`Unable to resolve billerCode for ${disco}`);

  // 3) Find productCode using biller-products (tenant-supported)
  const products = await listBillerProducts('ELECTRICITY');

  const matching = products.filter((p) => lower(getBPBillerCode(p)) === lower(billerCode));
  if (!matching.length) {
    throw new Error('Biller product not supported');
  }

  const wantPre = isPrepaid(mt) || isPrepaid(disco);
  const wantPost = isPostpaid(mt) || isPostpaid(disco);

  const chosen =
    matching.find((p) => {
      const n = lower(getBPProductName(p));
      const c = upper(getBPProductCode(p));
      if (!c) return false;
      if (wantPre) return n.includes('prepaid') || c.includes('PREPAID') || lower(c).includes('pre');
      if (wantPost) return n.includes('postpaid') || c.includes('POSTPAID') || lower(c).includes('post');
      return true;
    }) || matching[0];

  const productCode = getBPProductCode(chosen);
  if (!productCode) throw new Error('Biller product not supported');

  const resolved = { billerCode, productCode, expiresAtMs: now() + RESOLVE_TTL_MS };
  _resolvedCache.set(cacheKey, resolved);
  return resolved;
}

/**
 * Validate Meter
 * Monnify workflow: validate customer needs productCode + customerId. :contentReference[oaicite:2]{index=2}
 */
async function validateMeter(meterNumber, discoCode, meterType = 'prepaid') {
  const meter = safeStr(meterNumber);
  const disco = safeStr(discoCode);

  if (!meter || !disco) {
    throw new HttpError(400, 'meterNumber and discoCode are required');
  }

  const token = await getAccessToken();

  const { billerCode, productCode } = await resolveBillerAndProduct(disco, meterType);

  const resp = await httpPost(
    `${BASE_URL}/api/v1/vas/bills-payment/validate-customer`,
    {
      // Some tenants require billerCode; include it (safe even if ignored)
      billerCode,
      productCode,
      customerId: meter,
      // keep compatibility keys (harmless if ignored)
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

  const data = body?.responseBody || {};
  const vendInstruction = data?.vendInstruction || null;

  return {
    isValid: true,
    name: data?.name || data?.customerName || 'Customer',
    address: data?.address || null,
    meterNumber: meter,
    discoCode: disco, // keep original (biller-* or legacy)
    billerCode,
    productCode,
    validationReference: data?.validationReference || null,
    vendInstruction,
    raw: data,
  };
}

/**
 * Create Pending Order
 * Store resolved billerCode/productCode so vend step is deterministic.
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

  const resolved = await resolveBillerAndProduct(discoCode, mt);

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
        // ✅ store deterministic values for vend
        billerCode: resolved.billerCode,
        productCode: resolved.productCode,
        // keep original for traceability
        discoCode,
        validationReference: payload.validationReference,
        meterName: payload.meterName,
      },
    },
  });
}

/**
 * Vend Power (Webhook-triggered)
 * Monnify workflow: vend requires productCode, customerId, vendAmount, vendReference,
 * and validationReference only if required. :contentReference[oaicite:3]{index=3}
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
  const productCode = safeStr(meta.productCode);
  const meterNumber = safeStr(meta.meterNumber);
  const validationReference = safeStr(meta.validationReference);

  if (!productCode) throw new Error('Missing productCode on order metadata');
  if (!meterNumber) throw new Error('Missing meterNumber on order metadata');

  const vendAmount = Number(order.subTotal);
  if (!Number.isFinite(vendAmount) || vendAmount <= 0) throw new Error('Invalid vend amount');

  const vendPayload = {
    // include billerCode if present (safe)
    ...(billerCode ? { billerCode } : {}),
    productCode,
    customerId: meterNumber,
    // compatibility keys
    customerKey: meterNumber,
    customerIdentifier: meterNumber,
    vendAmount,
    vendReference,
  };

  // only send validationReference if present
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

async function retryVending(orderId) {
  return vendPower(orderId);
}

module.exports = {
  validateMeter,
  createPendingOrder,
  vendPower,
  getElectricityBillers,
  retryVending,
};
