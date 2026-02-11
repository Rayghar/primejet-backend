// File: src/api/v1/utilities/power.service.js

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');
const orderService = require('../orders/order.service');

const BASE_URL = process.env.MONNIFY_BASE_URL || 'https://sandbox.monnify.com';
const API_KEY = process.env.MONNIFY_API_KEY;
const SECRET_KEY = process.env.MONNIFY_SECRET_KEY;

const CONVENIENCE_FEE = parseFloat(process.env.POWER_CONVENIENCE_FEE || '100');
const HTTP_TIMEOUT = 50000;
const VEND_TIMEOUT = 60000;

/**
 * Auth cache
 */
let authCache = { token: null, expiresAt: 0 };

const now = () => Date.now();

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
 * Get Monnify Access Token
 */
async function getAccessToken() {
  if (authCache.token && authCache.expiresAt > now()) {
    return authCache.token;
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

  authCache.token = body.responseBody.accessToken;
  authCache.expiresAt = now() + 55 * 60 * 1000;
  return authCache.token;
}

/**
 * Get Electricity Billers
 */
async function getElectricityBillers(category = 'ELECTRICITY') {
  const token = await getAccessToken();

  const resp = await httpGet(
    `${BASE_URL}/api/v1/vas/bills-payment/billers?category_code=${category}`,
    monnifyAuthHeaderBearer(token),
    HTTP_TIMEOUT
  );

  const body = resp?.data;
  if (!body?.requestSuccessful) {
    throw new Error(body?.responseMessage || 'Failed to fetch billers');
  }

  return body.responseBody || [];
}

/**
 * Derive productCode from billerCode
 */
function deriveProductCode(billerCode) {
  if (billerCode.endsWith('-post')) return 'POSTPAID_ELECTRICITY';
  return 'PREPAID_ELECTRICITY';
}

/**
 * Validate Meter
 */
async function validateMeter(meterNumber, billerCode, meterType) {
  const token = await getAccessToken();
  const productCode = deriveProductCode(billerCode);

  const resp = await httpPost(
    `${BASE_URL}/api/v1/vas/bills-payment/validate-customer`,
    {
      billerCode,
      productCode,
      customerId: meterNumber,
      customerIdentifier: meterNumber,
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
    name: body.responseBody?.customerName || body.responseBody?.name,
    validationReference: body.responseBody?.validationReference,
    billerCode,
    productCode,
  };
}

/**
 * Create Pending Power Order
 */
async function createPendingOrder(payload) {
  if (!payload.userId) throw new HttpError(401, 'User required');

  const productCode = deriveProductCode(payload.billerCode);

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
        billerCode: payload.billerCode,
        productCode,
        validationReference: payload.validationReference,
        meterType: payload.meterType,
        meterName: payload.meterName,
        phone: payload.phone,
      },
    },
  });
}

/**
 * Vend Power (Webhook)
 */
async function vendPower(orderId) {
  const order = await orderService.getOrder(orderId, { id: 'system', role: 'admin' });
  const meta = order.metadata;

  if (meta?.token) {
    return { success: true, token: meta.token, cached: true };
  }

  const token = await getAccessToken();
  const vendReference = `${Date.now()}-${uuidv4().slice(0, 6)}`;

  const resp = await httpPost(
    `${BASE_URL}/api/v1/vas/bills-payment/vend`,
    {
      billerCode: meta.billerCode,
      productCode: meta.productCode,
      customerId: meta.meterNumber,
      vendAmount: order.subTotal,
      vendReference,
      validationReference: meta.validationReference,
    },
    monnifyAuthHeaderBearer(token),
    VEND_TIMEOUT
  );

  const body = resp?.data;
  if (!body?.requestSuccessful) {
    await orderService.updateOrderStatus(orderId, 'Vending Failed', body, 'system');
    throw new Error(body?.responseMessage || 'Vending failed');
  }

  const vendData = body.responseBody;

  await orderService.updateOrderStatus(
    orderId,
    'Delivered',
    {
      token: vendData.token || vendData.tokenNo,
      units: vendData.units,
      vendReference,
      vendorResponse: vendData,
    },
    'system'
  );

  return { success: true, token: vendData.token || vendData.tokenNo };
}

const retryVending = (orderId) => vendPower(orderId);

module.exports = {
  getElectricityBillers,
  validateMeter,
  createPendingOrder,
  vendPower,
  retryVending,
};
