// File: src/api/v1/utilities/power.service.js

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');
const orderService = require('../orders/order.service');
const notificationService = require('../notifications/notification.service');

// Configuration
// Sandbox: https://sandbox.monnify.com
// Live: https://api.monnify.com
const BASE_URL = process.env.MONNIFY_BASE_URL || 'https://sandbox.monnify.com';
const API_KEY = process.env.MONNIFY_API_KEY;
const SECRET_KEY = process.env.MONNIFY_SECRET_KEY;
const CONVENIENCE_FEE = parseFloat(process.env.POWER_CONVENIENCE_FEE || '100');

// Timeouts
const HTTP_TIMEOUT = 30000; // 30 seconds
const VEND_TIMEOUT = 45000; // 45 seconds

// --- HELPERS ---

/**
 * Map Frontend Disco Codes to Monnify Product Codes.
 */
const mapDiscoToMonnifyCode = (code, type = 'prepaid') => {
  const isPrepaid = String(type || 'prepaid').toLowerCase().includes('prepaid');

  const map = {
    'ikeja_electric_prepaid': 'MOB_PREPAID_IKEJA',
    'eko_electric_prepaid': 'MOB_PREPAID_EKO',
    'abuja_electric_prepaid': 'MOB_PREPAID_ABUJA',
    'ibadan_electric_prepaid': 'MOB_PREPAID_IBADAN',
    'enugu_electric_prepaid': 'MOB_PREPAID_ENUGU',
    'jos_electric_prepaid': 'MOB_PREPAID_JOS',
    'kano_electric_prepaid': 'MOB_PREPAID_KANO',
    'portharcourt_electric_prepaid': 'MOB_PREPAID_PH',

    // Direct matches if frontend sends generic disco codes
    'ikeja_electric': isPrepaid ? 'MOB_PREPAID_IKEJA' : 'MOB_POSTPAID_IKEJA',
    'eko_electric': isPrepaid ? 'MOB_PREPAID_EKO' : 'MOB_POSTPAID_EKO',
  };

  return map[code] || 'MOB_PREPAID_IKEJA'; // Fallback
};

/**
 * Get Access Token (Basic Auth)
 */
const getAccessToken = async () => {
  try {
    logger.info('[Monnify] Authenticating...');

    if (!API_KEY || !SECRET_KEY) {
      throw new Error('Monnify API Key/Secret missing in .env');
    }

    const authString = Buffer.from(`${API_KEY}:${SECRET_KEY}`).toString('base64');

    const response = await axios.post(
      `${BASE_URL}/api/v1/auth/login`,
      {},
      {
        headers: { Authorization: `Basic ${authString}` },
        timeout: HTTP_TIMEOUT,
        validateStatus: () => true,
      }
    );

    const body = response.data;
    if (body?.requestSuccessful && body?.responseBody?.accessToken) {
      logger.info('[Monnify] Auth Successful.');
      return body.responseBody.accessToken;
    }

    const msg = body?.responseMessage || 'No access token in response';
    throw new Error(msg);
  } catch (error) {
    logger.error(`[Monnify] Auth Failed: ${error.message}`);
    throw new Error('Service authentication failed. Please check server logs.');
  }
};

// --- CORE FUNCTIONS ---

/**
 * Step 1: Validate Meter
 * Monnify expects:
 *  - productCode
 *  - customerId (meter number)
 */
const validateMeter = async (meterNumber, discoCode, meterType = 'prepaid') => {
  try {
    // Basic validation
    const m = String(meterNumber || '').trim();
    const d = String(discoCode || '').trim();
    const t = String(meterType || 'prepaid').trim();

    if (!m) throw new HttpError(400, 'Meter number is required');
    if (!d) throw new HttpError(400, 'Disco code is required');

    // 1) Auth
    const token = await getAccessToken();

    // 2) Map Code
    const productCode = mapDiscoToMonnifyCode(d, t);
    logger.info(`[Monnify] Validating Meter: ${m} on ${productCode}`);

    // 3) Request
    const response = await axios.post(
      `${BASE_URL}/api/v1/vas/bills-payment/validate-customer`,
      {
        productCode,
        customerId: m, // ✅ FIX: customerId (not customerKey)
      },
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: HTTP_TIMEOUT,
        validateStatus: () => true, // Prevent crashing on 400/500
      }
    );

    const body = response.data;

    // 4) Handle Response
    if (body?.requestSuccessful) {
      const data = body.responseBody || {};
      logger.info(`[Monnify] Validation Success: ${data.name || data.customerName || 'Customer'}`);

      return {
        isValid: true,
        name: data.name || data.customerName || 'Customer',
        address: data.address || 'Address Not Provided',
        meterNumber: m,
        discoCode: d,
        validationReference: data.validationReference || null,
      };
    }

    const msg = body?.responseMessage || 'Meter validation failed';
    logger.warn(`[Monnify] Validation Logic Fail: ${msg}`);
    throw new Error(msg);
  } catch (error) {
    logger.error(`[Monnify] Validation Exception: ${error.message}`);

    const msg =
      error?.response?.data?.responseMessage ||
      error?.response?.data?.message ||
      error.message;

    if (String(msg).toLowerCase().includes('timeout')) {
      throw new HttpError(504, 'Provider took too long to respond. Try again.');
    }

    // If caller already threw HttpError, keep it
    if (error instanceof HttpError) throw error;

    throw new HttpError(400, `Validation Failed: ${msg}`);
  }
};

/**
 * Step 2: Create Pending Order (before payment)
 * Saves important data in metadata for vend step after payment.
 */
const createPendingOrder = async (userId, data) => {
  const {
    meterNumber,
    discoCode,
    amount,
    phone,
    email,
    meterName,
    meterType,
    validationReference, // ✅ NEW (optional)
  } = data || {};

  const m = String(meterNumber || '').trim();
  const d = String(discoCode || '').trim();
  const t = String(meterType || 'prepaid').trim();

  const electricityAmount = parseFloat(amount);
  if (!m) throw new HttpError(400, 'Meter number is required');
  if (!d) throw new HttpError(400, 'Disco code is required');
  if (!Number.isFinite(electricityAmount) || electricityAmount <= 0) {
    throw new HttpError(400, 'Invalid amount');
  }

  const totalPayable = electricityAmount + CONVENIENCE_FEE;

  // Create Order in DB
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
        meterNumber: m,
        discoCode: d,
        productCode: mapDiscoToMonnifyCode(d, t),
        meterType: t || 'prepaid',
        meterName: meterName || null,
        phone: phone || null,
        email: email || null,
        validationReference: validationReference || null, // ✅ NEW
      },
    },
  });

  return newOrder;
};

/**
 * Step 3: Vend Token (called by Webhook after payment)
 * Monnify expects vend payload:
 *  - productCode
 *  - customerId
 *  - vendAmount
 *  - vendReference
 *  - validationReference (only if required)
 */
const vendPower = async (orderId) => {
  logger.info(`[Monnify] Vending Power for Order: ${orderId}`);

  const order = await orderService.getOrder(orderId);
  if (!order) throw new Error('Order not found');

  // Idempotency: if already delivered and token exists, return cached.
  if (String(order.status).toUpperCase() === 'DELIVERED') {
    return { success: true, token: order.metadata.get('token'), cached: true };
  }

  try {
    const token = await getAccessToken();
    const vendReference = `${Date.now()}-${uuidv4().substring(0, 6)}`;

    const productCode = order.metadata.get('productCode');
    const meterNumber = order.metadata.get('meterNumber');
    const validationReference = order.metadata.get('validationReference');

    if (!productCode) throw new Error('Missing productCode on order metadata');
    if (!meterNumber) throw new Error('Missing meterNumber on order metadata');

    const payload = {
      productCode,
      customerId: meterNumber,          // ✅ FIX
      vendAmount: Number(order.subTotal), // ✅ FIX
      vendReference,                    // ✅ FIX
    };

    // Include only when available (some products require it)
    if (validationReference) {
      payload.validationReference = validationReference;
    }

    logger.info('[Monnify] Sending Vend Request...');

    const response = await axios.post(
      `${BASE_URL}/api/v1/vas/bills-payment/vend`,
      payload,
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: VEND_TIMEOUT,
        validateStatus: () => true, // handle non-2xx without throwing
      }
    );

    const body = response.data;

    if (body?.requestSuccessful) {
      const vendData = body.responseBody || {};

      // Token/units can vary by provider payload shape
      const tokenCode =
        vendData.token ||
        vendData.pin ||
        vendData.standardToken ||
        vendData.tokenCode ||
        'TOKEN_GENERATED';

      const units =
        vendData.units ||
        vendData.unit ||
        vendData.purchasedUnits ||
        '0';

      // ✅ IMPORTANT: use a valid status in your enum (Delivered exists; Completed may not)
      await orderService.updateOrderStatus(
        orderId,
        'Delivered',
        {
          token: tokenCode,
          units: units,
          vendorReference: vendData.transactionReference || null,
          vendorResponse: JSON.stringify(vendData),
          vendReference,
        },
        'system'
      );

      // Optional: Send Notification
      try {
        await notificationService.createAndSendNotification(
          order.user?._id || order.user,
          'Power Token Generated',
          `Token: ${tokenCode}`,
          { type: 'POWER_ORDER', orderId: orderId, token: tokenCode }
        );
      } catch (e) {
        // ignore notification failures
      }

      return { success: true, token: tokenCode, units };
    }

    const failMsg = body?.responseMessage || 'Monnify vending failed';
    throw new Error(failMsg);
  } catch (error) {
    logger.error(`[Monnify] Vending FAILED: ${error.message}`);

    const failReason =
      error?.response?.data?.responseMessage ||
      error?.response?.data?.message ||
      error.message;

    try {
      await orderService.updateOrderStatus(
        orderId,
        'Vending Failed',
        { error: failReason },
        'system'
      );
    } catch (e) {
      // don't mask the original error
    }

    throw error;
  }
};

module.exports = { validateMeter, createPendingOrder, vendPower };
