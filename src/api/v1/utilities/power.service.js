// File: src/api/v1/utilities/power.service.js

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');
const orderService = require('../orders/order.service');

// ✅ Defensive import for notification service (paths vary across your repo)
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
      logger.warn('[POWER_SERVICE] notification.service not found. Will skip persist notifications.');
    }
  }
}

/**
 * Configuration
 * Sandbox: https://sandbox.monnify.com
 * Live:    https://api.monnify.com
 */
const BASE_URL = process.env.MONNIFY_BASE_URL || 'https://sandbox.monnify.com';
const API_KEY = process.env.MONNIFY_API_KEY;
const SECRET_KEY = process.env.MONNIFY_SECRET_KEY;

// Optional fee applied by your platform (not Monnify)
const CONVENIENCE_FEE = parseFloat(process.env.POWER_CONVENIENCE_FEE || '100');

// Timeouts
const HTTP_TIMEOUT = 30000;
const VEND_TIMEOUT = 45000;

// ------------------------------------------------------------
// In-memory caches (safe + simple)
// ------------------------------------------------------------
let _authCache = {
  accessToken: null,
  expiresAtMs: 0,
};

// Cache billers & products to avoid hammering Monnify
const _billersCache = new Map(); // key: categoryCode -> { expiresAtMs, data }
const _productsCache = new Map(); // key: billerCode -> { expiresAtMs, data }
const _resolvedProductCache = new Map(); // key: providerCode|meterType -> { expiresAtMs, productCode, billerCode }

// Cache TTLs
const AUTH_TTL_MS = 55 * 60 * 1000; // 55 mins (Monnify tokens are typically 60 mins)
const BILLERS_TTL_MS = 6 * 60 * 60 * 1000; // 6 hrs
const PRODUCTS_TTL_MS = 6 * 60 * 60 * 1000; // 6 hrs
const RESOLVE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hrs

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
function now() {
  return Date.now();
}

function safeStr(v) {
  return String(v ?? '').trim();
}

function looksLikeProductCode(code) {
  const c = safeStr(code);
  // product codes are often uppercase with underscores, but not guaranteed.
  // We still allow passing through anything that isn't your legacy "disco" pattern.
  return (
    c.startsWith('MOB_') ||
    c.startsWith('BILL_') ||
    c.startsWith('ELEC_') ||
    /^[A-Z0-9_]{6,}$/.test(c)
  );
}

function extractDiscoKeyword(providerCode) {
  const c = safeStr(providerCode).toLowerCase();
  const known = [
    'ikeja',
    'eko',
    'abuja',
    'ibadan',
    'enugu',
    'jos',
    'kano',
    'portharcourt',
    'ph',
  ];
  return known.find((k) => c.includes(k)) || null;
}

function isPrepaid(meterTypeOrProvider) {
  const s = safeStr(meterTypeOrProvider).toLowerCase();
  // your frontend encodes prepaid in providerCode (eko_electric_prepaid)
  return s.includes('prepaid');
}

function isPostpaid(meterTypeOrProvider) {
  const s = safeStr(meterTypeOrProvider).toLowerCase();
  return s.includes('postpaid');
}

function monnifyAuthHeaderBasic() {
  const authString = Buffer.from(`${API_KEY}:${SECRET_KEY}`).toString('base64');
  return { Authorization: `Basic ${authString}` };
}

function monnifyAuthHeaderBearer(token) {
  return { Authorization: `Bearer ${token}` };
}

function normalizeCategoryCode(category) {
  // Monnify support used: category_code=ELECTRICITY
  // We accept both "category" and "categoryCode" from callers.
  const c = safeStr(category).toUpperCase();
  return c || 'ELECTRICITY';
}

async function httpPost(url, data, headers, timeout) {
  return axios.post(url, data, {
    headers,
    timeout,
    validateStatus: () => true, // never throw on non-2xx
  });
}

async function httpGet(url, headers, timeout) {
  return axios.get(url, {
    headers,
    timeout,
    validateStatus: () => true,
  });
}

// ------------------------------------------------------------
// Auth
// ------------------------------------------------------------
async function getAccessToken() {
  const ts = now();

  // Use cache if valid
  if (_authCache.accessToken && _authCache.expiresAtMs > ts) {
    logger.debug('[Monnify][AUTH] cache hit');
    return _authCache.accessToken;
  }

  logger.info(
    `[Monnify][AUTH] start baseUrl=${BASE_URL} hasKey=${!!API_KEY} hasSecret=${!!SECRET_KEY}`
  );

  if (!API_KEY || !SECRET_KEY) {
    logger.error('[Monnify][AUTH] missing api credentials (MONNIFY_API_KEY / MONNIFY_SECRET_KEY)');
    throw new Error('Monnify API Key/Secret missing in env');
  }

  const url = `${BASE_URL}/api/v1/auth/login`;
  const resp = await httpPost(url, {}, monnifyAuthHeaderBasic(), HTTP_TIMEOUT);

  const body = resp?.data;
  const requestSuccessful = body?.requestSuccessful;
  const message = body?.responseMessage;

  logger.info(`[Monnify][AUTH] status=${resp.status} requestSuccessful=${!!requestSuccessful} message=${message || 'n/a'}`);

  if (!requestSuccessful || !body?.responseBody?.accessToken) {
    const errMsg = message || body?.responseBody?.message || 'No access token in response';
    logger.error(`[Monnify][AUTH] failed: ${errMsg}`);
    throw new Error('Service authentication failed. Please check server logs.');
  }

  _authCache.accessToken = body.responseBody.accessToken;
  _authCache.expiresAtMs = ts + AUTH_TTL_MS;
  logger.info('[Monnify][AUTH] success');

  return _authCache.accessToken;
}

// ------------------------------------------------------------
// Catalog (Billers & Products)
// ------------------------------------------------------------

/**
 * Get list of billers for a category.
 * Support instruction:
 *  /api/v1/vas/bills-payment/billers?category_code=ELECTRICITY
 */
async function listBillers(categoryCode = 'ELECTRICITY') {
  const cat = normalizeCategoryCode(categoryCode);

  const cached = _billersCache.get(cat);
  if (cached && cached.expiresAtMs > now()) {
    logger.debug(`[Monnify][BILLERS] cache hit category=${cat} count=${cached.data?.length || 0}`);
    return cached.data;
  }

  const token = await getAccessToken();

  // ✅ Use category_code per support
  const url = `${BASE_URL}/api/v1/vas/bills-payment/billers?category_code=${encodeURIComponent(cat)}`;

  logger.info(`[Monnify][BILLERS] fetch category=${cat}`);
  const resp = await httpGet(url, monnifyAuthHeaderBearer(token), HTTP_TIMEOUT);

  const body = resp?.data;
  logger.info(`[Monnify][BILLERS] status=${resp.status} requestSuccessful=${!!body?.requestSuccessful} message=${body?.responseMessage || 'n/a'}`);

  if (!body?.requestSuccessful) {
    const msg = body?.responseMessage || 'Failed to fetch billers';
    logger.error(`[Monnify][BILLERS][FAIL] ${msg}`);
    throw new Error(msg);
  }

  // shape: responseBody might be an array or an object containing content/list
  const list =
    Array.isArray(body?.responseBody) ? body.responseBody :
    Array.isArray(body?.responseBody?.content) ? body.responseBody.content :
    Array.isArray(body?.responseBody?.billers) ? body.responseBody.billers :
    [];

  _billersCache.set(cat, { expiresAtMs: now() + BILLERS_TTL_MS, data: list });

  logger.info(`[Monnify][BILLERS] ok category=${cat} count=${list.length}`);
  return list;
}

/**
 * Get products for a biller (if your Monnify profile requires this step).
 * Different tenants sometimes expose products under a separate endpoint;
 * we implement the most common patterns and try them in order.
 */
async function listProductsForBiller(billerCode) {
  const b = safeStr(billerCode);
  if (!b) throw new Error('billerCode is required');

  const cached = _productsCache.get(b);
  if (cached && cached.expiresAtMs > now()) {
    logger.debug(`[Monnify][PRODUCTS] cache hit billerCode=${b} count=${cached.data?.length || 0}`);
    return cached.data;
  }

  const token = await getAccessToken();

  // Try common endpoints (Monnify docs/tenants vary)
  const candidates = [
    `${BASE_URL}/api/v1/vas/bills-payment/billers/${encodeURIComponent(b)}/products`,
    `${BASE_URL}/api/v1/vas/bills-payment/billers/products?biller_code=${encodeURIComponent(b)}`,
    `${BASE_URL}/api/v1/vas/bills-payment/billers/products?billerCode=${encodeURIComponent(b)}`,
  ];

  for (const url of candidates) {
    logger.info(`[Monnify][PRODUCTS] fetch billerCode=${b} url=${url.replace(BASE_URL, '')}`);
    const resp = await httpGet(url, monnifyAuthHeaderBearer(token), HTTP_TIMEOUT);
    const body = resp?.data;

    logger.info(`[Monnify][PRODUCTS] status=${resp.status} requestSuccessful=${!!body?.requestSuccessful} message=${body?.responseMessage || 'n/a'}`);

    if (resp.status === 404) continue; // try next pattern

    if (!body?.requestSuccessful) {
      const msg = body?.responseMessage || 'Failed to fetch products';
      logger.error(`[Monnify][PRODUCTS][FAIL] ${msg}`);
      throw new Error(msg);
    }

    const list =
      Array.isArray(body?.responseBody) ? body.responseBody :
      Array.isArray(body?.responseBody?.content) ? body.responseBody.content :
      Array.isArray(body?.responseBody?.products) ? body.responseBody.products :
      [];

    _productsCache.set(b, { expiresAtMs: now() + PRODUCTS_TTL_MS, data: list });

    logger.info(`[Monnify][PRODUCTS] ok billerCode=${b} count=${list.length}`);
    return list;
  }

  // If all candidates failed
  logger.error('[Monnify][PRODUCTS][FAIL] No supported products endpoint matched for this tenant.');
  throw new Error('Products endpoint not available for this Monnify tenant.');
}

/**
 * Resolve your legacy providerCode (eko_electric_prepaid, ikeja_electric_prepaid, etc)
 * to the actual supported Monnify productCode (returned by billers/products endpoints).
 */
async function resolveProductFromLegacy(providerCode, meterType = null) {
  const p = safeStr(providerCode);
  const typeHint = safeStr(meterType) || p;

  const cacheKey = `${p}|${typeHint.toLowerCase()}`;
  const cached = _resolvedProductCache.get(cacheKey);
  if (cached && cached.expiresAtMs > now()) {
    logger.debug(`[Monnify][RESOLVE] cache hit key=${cacheKey} -> ${cached.productCode}`);
    return { productCode: cached.productCode, billerCode: cached.billerCode };
  }

  const keyword = extractDiscoKeyword(p);
  if (!keyword) {
    throw new Error(`Unable to resolve providerCode: ${p}`);
  }

  const prepaid = isPrepaid(typeHint);
  const postpaid = isPostpaid(typeHint);

  const billers = await listBillers('ELECTRICITY');

  // Try to locate biller by name/code match
  const biller = billers.find((b) => {
    const name = safeStr(b?.billerName || b?.name).toLowerCase();
    const code = safeStr(b?.billerCode || b?.code).toLowerCase();
    return name.includes(keyword) || code.includes(keyword);
  });

  if (!biller) {
    throw new Error(`No electricity biller matched keyword=${keyword} for providerCode=${p}`);
  }

  const billerCode = safeStr(biller?.billerCode || biller?.code);
  if (!billerCode) {
    throw new Error('Resolved biller is missing billerCode');
  }

  let productCode = safeStr(biller?.productCode || biller?.product_code);

  // If biller response already includes a usable productCode, great.
  // Else, query products.
  if (!productCode) {
    const products = await listProductsForBiller(billerCode);

    // Choose a product using prepaid/postpaid hints
    const match = products.find((pr) => {
      const n = safeStr(pr?.productName || pr?.name).toLowerCase();
      const c = safeStr(pr?.productCode || pr?.code).toUpperCase();
      if (!c) return false;

      if (prepaid) return n.includes('prepaid') || c.includes('PREPAID');
      if (postpaid) return n.includes('postpaid') || c.includes('POSTPAID');

      // If no hint, just pick first
      return true;
    });

    productCode = safeStr(match?.productCode || match?.code);
  }

  if (!productCode) {
    throw new Error(`Unable to resolve productCode for providerCode=${p} (billerCode=${billerCode})`);
  }

  _resolvedProductCache.set(cacheKey, {
    expiresAtMs: now() + RESOLVE_TTL_MS,
    productCode,
    billerCode,
  });

  logger.info(`[Monnify][RESOLVE] providerCode=${p} -> billerCode=${billerCode} productCode=${productCode}`);
  return { productCode, billerCode };
}

// ------------------------------------------------------------
// Core Functions
// ------------------------------------------------------------

/**
 * Validate Meter
 * We accept either:
 * - productCode directly (preferred after you wire catalog), OR
 * - legacy providerCode (eko_electric_prepaid) which we resolve.
 */
async function validateMeter(meterNumber, providerOrProductCode, meterType = 'prepaid') {
  const meter = safeStr(meterNumber);
  const providerCode = safeStr(providerOrProductCode);

  if (!meter) throw new HttpError(400, 'meterNumber is required');
  if (!providerCode) throw new HttpError(400, 'discoCode/productCode is required');

  const token = await getAccessToken();

  let productCode = null;
  let billerCode = null;

  try {
    if (looksLikeProductCode(providerCode) && !providerCode.includes('_electric_')) {
      productCode = providerCode;
      logger.info(`[Monnify][VALIDATE] using productCode directly productCode=${productCode}`);
    } else {
      const resolved = await resolveProductFromLegacy(providerCode, meterType);
      productCode = resolved.productCode;
      billerCode = resolved.billerCode;
    }

    logger.info(`[Monnify][VALIDATE] meter=${meter} providerCode=${providerCode} productCode=${productCode}`);

    const url = `${BASE_URL}/api/v1/vas/bills-payment/validate-customer`;
    const resp = await httpPost(
      url,
      // ✅ Your tenant may expect customerKey or customerId; keep both to be safe.
      { productCode, customerId: meter, customerKey: meter },
      monnifyAuthHeaderBearer(token),
      HTTP_TIMEOUT
    );

    const body = resp?.data;
    logger.info(
      `[Monnify][VALIDATE] status=${resp.status} requestSuccessful=${!!body?.requestSuccessful} message=${body?.responseMessage || 'n/a'}`
    );

    if (!body?.requestSuccessful) {
      const msg = body?.responseMessage || 'Meter validation failed';
      logger.error(`[Monnify][VALIDATE][FAIL] ${msg}`);
      throw new HttpError(400, `Validation Failed: ${msg}`);
    }

    const data = body?.responseBody || {};

    // Pass through important hints if Monnify returns vendInstruction
    const vendInstruction = data?.vendInstruction || null;

    return {
      isValid: true,
      name: data?.name || data?.customerName || 'Customer',
      address: data?.address || 'Address Not Provided',
      meterNumber: meter,
      providerCode,
      productCode,
      billerCode,
      validationReference: data?.validationReference || null,
      vendInstruction,
      raw: data, // optional but useful during integration
    };
  } catch (err) {
    // Keep HttpError
    if (err instanceof HttpError) throw err;

    const msg =
      err?.response?.data?.responseMessage ||
      err?.response?.data?.message ||
      err?.message ||
      'Unknown error';

    logger.error(`[Monnify][VALIDATE][EXCEPTION] ${msg}`);
    throw new HttpError(400, `Validation Failed: ${msg}`);
  }
}

/**
 * Create pending order (before payment)
 * Store the *resolved* productCode so vend doesn’t depend on remapping.
 */
async function createPendingOrder(payload) {
  const userId = payload.userId;
  const meterNumber = safeStr(payload.meterNumber);
  const providerCode = safeStr(payload.discoCode || payload.providerCode);
  const meterType = safeStr(payload.meterType || 'prepaid');
  const amount = Number(payload.amount);

  if (!userId) throw new HttpError(401, 'User ID is required');
  if (!meterNumber) throw new HttpError(400, 'meterNumber is required');
  if (!providerCode) throw new HttpError(400, 'discoCode/providerCode is required');
  if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, 'amount is invalid');

  // Resolve productCode
  let productCode = safeStr(payload.productCode);
  let billerCode = safeStr(payload.billerCode);

  if (!productCode) {
    const resolved = await resolveProductFromLegacy(providerCode, meterType);
    productCode = resolved.productCode;
    billerCode = resolved.billerCode;
  }

  const totalPayable = amount + CONVENIENCE_FEE;

  const order = await orderService.placeOrder({
    user: { id: userId },
    body: {
      type: 'POWER',
      totalAmount: totalPayable,
      subTotal: amount,
      serviceFee: CONVENIENCE_FEE,
      status: 'Pending Payment',
      paymentStatus: 'Pending',
      metadata: {
        meterNumber,
        providerCode,
        billerCode,
        productCode,
        meterType,
        meterName: payload.meterName,
        phone: payload.phone,
        validationReference: payload.validationReference,
      },
    },
  });

  return order;
}

/**
 * Vend after payment webhook
 * Uses productCode saved in metadata.
 */
async function vendPower(orderId) {
  logger.info(`[Monnify][VEND] start orderId=${orderId}`);

  const order = await orderService.getOrder(orderId);
  if (!order) throw new Error('Order not found');

  const status = safeStr(order.status).toUpperCase();
  const meta = order.metadata;

  // Idempotency: if already delivered and token exists
  const existingToken = meta?.get ? meta.get('token') : meta?.token;
  if ((status === 'DELIVERED' || status === 'COMPLETED') && existingToken) {
    logger.info('[Monnify][VEND] idempotent return (already has token)');
    return { success: true, token: existingToken, cached: true };
  }

  const token = await getAccessToken();

  const productCode = meta?.get ? meta.get('productCode') : meta?.productCode;
  const meterNumber = meta?.get ? meta.get('meterNumber') : meta?.meterNumber;
  const validationReference = meta?.get ? meta.get('validationReference') : meta?.validationReference;

  if (!productCode) throw new Error('Missing productCode on order metadata');
  if (!meterNumber) throw new Error('Missing meterNumber on order metadata');

  const vendReference = `${Date.now()}-${uuidv4().substring(0, 6)}`;

  const vendAmount = Number(order.subTotal);
  if (!Number.isFinite(vendAmount) || vendAmount <= 0) throw new Error('Invalid vend amount');

  const url = `${BASE_URL}/api/v1/vas/bills-payment/vend`;
  const vendPayload = {
    productCode,
    // same reason as validate: support both keys across tenants
    customerId: meterNumber,
    customerKey: meterNumber,
    vendAmount,
    vendReference,
  };

  if (validationReference) {
    vendPayload.validationReference = validationReference;
  }

  logger.info(
    `[Monnify][VEND] request productCode=${productCode} meter=${meterNumber} amount=${vendAmount} vendReference=${vendReference}`
  );

  const resp = await httpPost(url, vendPayload, monnifyAuthHeaderBearer(token), VEND_TIMEOUT);
  const body = resp?.data;

  logger.info(`[Monnify][VEND] status=${resp.status} requestSuccessful=${!!body?.requestSuccessful} message=${body?.responseMessage || 'n/a'}`);

  if (!body?.requestSuccessful) {
    const msg = body?.responseMessage || 'Monnify vending failed';
    logger.error(`[Monnify][VEND][FAIL] ${msg}`);

    try {
      await orderService.updateOrderStatus(
        orderId,
        'Vending Failed',
        { error: msg, vendorResponse: JSON.stringify(body || {}) },
        'system'
      );
    } catch (_) {}

    throw new Error(msg);
  }

  const vendData = body?.responseBody || {};

  const tokenCode =
    vendData.token ||
    vendData.pin ||
    vendData.standardToken ||
    vendData.tokenCode ||
    vendData.tokenNo ||
    'TOKEN_GENERATED';

  const units =
    vendData.units ||
    vendData.unit ||
    vendData.purchasedUnits ||
    vendData.vendQuantity ||
    '0';

  // Update order status (your app uses "Delivered" widely)
  await orderService.updateOrderStatus(
    orderId,
    'Delivered',
    {
      token: tokenCode,
      units,
      vendorReference: vendData.transactionReference || vendData.reference || null,
      vendorResponse: JSON.stringify(vendData),
      vendReference,
    },
    'system'
  );

  // Notify user (optional)
  try {
    const userId = order.user?._id || order.user;
    if (notificationService?.createAndSendNotification) {
      await notificationService.createAndSendNotification(
        userId,
        'Power Token Generated',
        `Token: ${tokenCode}`,
        { type: 'POWER_ORDER', orderId, token: tokenCode }
      );
    }
  } catch (_) {}

  logger.info('[Monnify][VEND] success');
  return { success: true, token: tokenCode, units };
}

/**
 * Public methods for controller routes
 */
async function getElectricityBillers(categoryCode = 'ELECTRICITY') {
  return listBillers(categoryCode);
}

async function getBillerProducts(billerCode) {
  return listProductsForBiller(billerCode);
}

async function retryVending(orderId) {
  logger.info(`[Monnify][RETRY VEND] orderId=${orderId}`);
  
  try {
    const result = await vendPower(orderId);   // Reuse existing vend logic
    return result;
  } catch (error) {
    logger.error(`[Monnify][RETRY VEND] failed: ${error.message}`);
    throw error;
  }
}

module.exports = {
  validateMeter,
  createPendingOrder,
  vendPower,
  getElectricityBillers,
  getBillerProducts,
  retryVending,
};
