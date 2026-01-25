// File: src/api/v1/utilities/power.service.js
const axios = require('axios');
const crypto = require('crypto');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');
const orderService = require('../orders/order.service');
const notificationService = require('../notifications/notification.service');
// ✅ CRITICAL: Import Order model directly to bypass service-layer auth checks during webhook/vending
const Order = require('../../../models/order.model');

/**
 * ============================================================================
 * VTpass configuration
 * ============================================================================
 * VTpass uses header-based API key auth:
 *  - POST requests: api-key + secret-key
 *  - GET requests:  api-key + public-key
 * See: https://www.vtpass.com/documentation/authentication/
 */
const VTPASS_BASE_URL = (process.env.VTPASS_BASE_URL || 'https://vtpass.com/api').replace(/\/+$/, '');
const VTPASS_API_KEY = process.env.VTPASS_API_KEY;
const VTPASS_SECRET_KEY = process.env.VTPASS_SECRET_KEY;
const VTPASS_PUBLIC_KEY = process.env.VTPASS_PUBLIC_KEY;

const CONVENIENCE_FEE = parseFloat(process.env.POWER_CONVENIENCE_FEE || '100');
const VTPASS_TIMEOUT_MS = parseInt(process.env.VTPASS_TIMEOUT_MS || '20000', 10);

// Map common aliases to VTpass serviceIDs.
// ✅ IMPORTANT: Include Flutter codes like ikeja_electric_prepaid.
const DISCO_TO_SERVICE_ID = {
  // --- Flutter UI values (underscore style) ---
  'ikeja_electric_prepaid': 'ikeja-electric',
  'ikeja_electric_postpaid': 'ikeja-electric',
  'eko_electric_prepaid': 'eko-electric',
  'eko_electric_postpaid': 'eko-electric',
  'abuja_electric_prepaid': 'abuja-electric',
  'abuja_electric_postpaid': 'abuja-electric',
  'ibadan_electric_prepaid': 'ibadan-electric',
  'ibadan_electric_postpaid': 'ibadan-electric',
  'enugu_electric_prepaid': 'enugu-electric',
  'enugu_electric_postpaid': 'enugu-electric',
  'jos_electric_prepaid': 'jos-electric',
  'jos_electric_postpaid': 'jos-electric',

  // --- Lagos ---
  'ikedc': 'ikeja-electric',
  'ikeja': 'ikeja-electric',
  'ikeja-electric': 'ikeja-electric',
  'ekedc': 'eko-electric',
  'eko': 'eko-electric',
  'eko-electric': 'eko-electric',

  // --- Abuja / North ---
  'aedc': 'abuja-electric',
  'abuja': 'abuja-electric',
  'abuja-electric': 'abuja-electric',
  'kedco': 'kano-electric',
  'kano': 'kano-electric',
  'kano-electric': 'kano-electric',
  'jed': 'jos-electric',
  'jos': 'jos-electric',
  'jos-electric': 'jos-electric',
  'kaedco': 'kaduna-electric',
  'kaduna': 'kaduna-electric',
  'kaduna-electric': 'kaduna-electric',

  // --- South / East / West ---
  'phed': 'portharcourt-electric',
  'ph': 'portharcourt-electric',
  'portharcourt-electric': 'portharcourt-electric',
  'eedc': 'enugu-electric',
  'enugu': 'enugu-electric',
  'enugu-electric': 'enugu-electric',
  'ibedc': 'ibadan-electric',
  'ibadan': 'ibadan-electric',
  'ibadan-electric': 'ibadan-electric',
  'bedc': 'benin-electric',
  'benin': 'benin-electric',
  'benin-electric': 'benin-electric',
  'aba': 'aba-electric',
  'aba-electric': 'aba-electric',
  'yedc': 'yola-electric',
  'yola': 'yola-electric',
  'yola-electric': 'yola-electric',
};

function normalizeDiscoCode(input) {
  // ✅ FIX: supports underscore inputs (Flutter)
  // ikeja_electric_prepaid -> ikeja-electric-prepaid
  const s = String(input || '').trim().toLowerCase();
  return s.replace(/[\s_]+/g, '-');
}

function resolveServiceId(discoCode) {
  // Try direct key first (because we store Flutter underscore keys)
  const direct = String(discoCode || '').trim().toLowerCase();
  if (DISCO_TO_SERVICE_ID[direct]) return DISCO_TO_SERVICE_ID[direct];

  const key = normalizeDiscoCode(discoCode);
  return DISCO_TO_SERVICE_ID[key] || null;
}

function ensureVtpassKeysPresent(isPostRequest) {
  if (!VTPASS_API_KEY) throw new HttpError(500, 'VTpass API key is not configured on the server');
  if (isPostRequest && !VTPASS_SECRET_KEY) throw new HttpError(500, 'VTpass Secret key is not configured on the server');
  if (!isPostRequest && !VTPASS_PUBLIC_KEY) throw new HttpError(500, 'VTpass Public key is not configured on the server');
}

/**
 * VTpass Request ID format rules (summary):
 * - MUST be 12+ chars
 * - First 12 chars MUST be numeric: YYYYMMDDHHmm (Africa/Lagos / GMT+1)
 * - Can append any alphanumeric suffix
 * See: https://www.vtpass.com/documentation/how-to-generate-request-id/
 */
function generateVtpassRequestId() {
  const dt = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(dt);

  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  const yyyy = get('year');
  const mm = get('month');
  const dd = get('day');
  const HH = get('hour');
  const ii = get('minute');

  const prefix = `${yyyy}${mm}${dd}${HH}${ii}`; // 12 digits
  const suffix = crypto.randomBytes(8).toString('hex'); // alphanumeric
  return `${prefix}${suffix}`;
}

function vtpassHeadersForPost() {
  ensureVtpassKeysPresent(true);
  return {
    'Content-Type': 'application/json',
    'api-key': VTPASS_API_KEY,
    'secret-key': VTPASS_SECRET_KEY,
  };
}

function vtpassHeadersForGet() {
  ensureVtpassKeysPresent(false);
  return {
    'Content-Type': 'application/json',
    'api-key': VTPASS_API_KEY,
    'public-key': VTPASS_PUBLIC_KEY,
  };
}

/**
 * Step 1: Validate Meter via VTpass merchant-verify
 */
const validateMeter = async (meterNumber, discoCode, meterType = 'prepaid') => {
  try {
    const serviceID = resolveServiceId(discoCode);
    if (!serviceID) throw new HttpError(400, `Unsupported Disco code: ${discoCode}`);

    const type = String(meterType || 'prepaid').toLowerCase() === 'postpaid' ? 'postpaid' : 'prepaid';

    logger.info(`[PowerService][VTpass] Validating meter: ${meterNumber} (${serviceID}, ${type})`);

    const response = await axios.post(
      `${VTPASS_BASE_URL}/merchant-verify`,
      {
        billersCode: String(meterNumber).trim(),
        serviceID,
        type,
      },
      { headers: vtpassHeadersForPost(), timeout: VTPASS_TIMEOUT_MS }
    );

    const payload = response?.data;

    if (payload?.code === '000' && payload?.content) {
      return {
        isValid: true,
        name: payload.content.Customer_Name || payload.content.customer_name || payload.content.name || '',
        address: payload.content.Address || payload.content.address || '',
        discoCode: discoCode,
        meterNumber: String(meterNumber).trim(),
        meterType: type,
        accountType: payload.content.Customer_Account_Type || payload.content.customer_account_type || '',
        canVend: payload.content.Can_Vend || payload.content.can_vend || '',
        minimumAmount: payload.content.Minimum_Amount || payload.content.minimum_amount || '',
      };
    }

    logger.warn(`[PowerService][VTpass] Meter validation not successful: ${JSON.stringify(payload)}`);
    throw new HttpError(400, 'Unable to verify meter details. Please check the number and Disco.');
  } catch (error) {
    const msg = error?.response?.data ? JSON.stringify(error.response.data) : error.message;
    logger.error(`[PowerService][VTpass] Meter validation failed: ${msg}`);
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'Unable to verify meter details. Please check the number and Disco.');
  }
};

/**
 * Step 2: Create Pending Order
 */
const createPendingOrder = async (userId, data) => {
  const { meterNumber, discoCode, amount, phone, email, meterName, meterType } = data;

  const amountNaira = parseFloat(amount);
  if (!Number.isFinite(amountNaira) || amountNaira <= 0) {
    throw new HttpError(400, 'Invalid amount');
  }

  const amountKobo = amountNaira * 100;
  const feeKobo = CONVENIENCE_FEE * 100;
  const totalPayableKobo = amountKobo + feeKobo;

  logger.info(`[PowerService] Creating Power Order. Amount: ${amountNaira}, Fee: ${CONVENIENCE_FEE}`);

  const newOrder = await orderService.placeOrder(userId, {
    type: 'POWER',
    items: [],
    totalAmount: totalPayableKobo / 100,
    subTotal: amountNaira,
    serviceFee: CONVENIENCE_FEE,
    deliveryFee: 0,
    status: 'Pending Payment',
    paymentStatus: 'Pending',
    metadata: {
      meterNumber: String(meterNumber || '').trim(),
      discoCode: String(discoCode || '').trim(),
      meterName: String(meterName || '').trim(),
      meterType: String(meterType || 'prepaid').toLowerCase() === 'postpaid' ? 'postpaid' : 'prepaid',
      phone: String(phone || '').trim(),
      email: String(email || '').trim(),
      units: '0',
      vendor: 'vtpass',
    },
  });

  return newOrder.order;
};

/**
 * Step 3: Vend Token via VTpass (After Payment)
 */
const vendPower = async (orderIdOrMongoId) => {
  logger.info(`[PowerService] Attempting to vend power for Order: ${orderIdOrMongoId}`);

  let order = await Order.findOne({ id: orderIdOrMongoId });
  if (!order && /^[a-f0-9]{24}$/i.test(String(orderIdOrMongoId))) {
    order = await Order.findById(orderIdOrMongoId);
  }
  if (!order) throw new Error('Order not found');

  const orderId = order.id;

  // Idempotency check
  if (['Completed', 'Delivered'].includes(order.status) || order.paymentStatus === 'Completed') {
    logger.warn(`[PowerService] Order ${orderId} already completed.`);
    const token = order.metadata ? order.metadata.get('token') : null;
    const units = order.metadata ? order.metadata.get('units') : null;
    return { success: true, token, units, cached: true };
  }

  try {
    const serviceID = resolveServiceId(order.metadata.get('discoCode'));
    if (!serviceID) throw new HttpError(400, `Unsupported Disco code: ${order.metadata.get('discoCode')}`);

    const billersCode = order.metadata.get('meterNumber');
    const phone = order.metadata.get('phone') || '08000000000';
    const variation_code = (order.metadata.get('meterType') || 'prepaid').toLowerCase() === 'postpaid' ? 'postpaid' : 'prepaid';

    const amountToVend = order.subTotal || (order.grandTotal - CONVENIENCE_FEE);
    const request_id = generateVtpassRequestId();

    logger.info(
      `[PowerService][VTpass] PAY request_id=${request_id} serviceID=${serviceID} billersCode=${billersCode} amount=${amountToVend} type=${variation_code}`
    );

    const response = await axios.post(
      `${VTPASS_BASE_URL}/pay`,
      {
        request_id,
        serviceID,
        billersCode,
        variation_code,
        amount: amountToVend,
        phone,
      },
      { headers: vtpassHeadersForPost(), timeout: VTPASS_TIMEOUT_MS }
    );

    const payload = response?.data;

    if (payload?.code === '000' && payload?.content?.transactions) {
      const tx = payload.content.transactions;
      const status = String(tx.status || '').toLowerCase();

      const token =
        payload.content?.tokens?.token ||
        payload.content?.token ||
        tx.token ||
        tx.tokenCode ||
        null;

      const units =
        payload.content?.tokens?.units ||
        payload.content?.units ||
        tx.units ||
        null;

      if (!order.metadata) order.metadata = new Map();
      order.metadata.set('vendorRequestId', request_id);
      order.metadata.set('vendorStatus', status || 'delivered');
      if (token) order.metadata.set('token', String(token));
      if (units) order.metadata.set('units', String(units));
      if (tx.transactionId) order.metadata.set('vendorReference', String(tx.transactionId));
      await order.save();

      if (status === 'delivered') {
        await orderService.updateOrderStatus({
          orderId,
          status: 'Completed',
          paymentStatus: 'Completed',
          notes: `Vending Successful via VTpass. Token generated.`,
          verifiedAmount: order.finalAmountPaid,
        });

        try {
          await notificationService.createAndSendNotification(
            order.customerId,
            'Power Token Generated',
            token ? `Your token is: ${token}${units ? ` (${units}kWh)` : ''}.` : 'Your electricity purchase was successful.',
            'POWER_ORDER',
            { orderId, token }
          );
        } catch (e) {
          logger.warn(`[PowerService] Notification failed: ${e.message}`);
        }

        return { success: true, token, units, request_id, status: 'delivered' };
      }

      await orderService.updateOrderStatus({
        orderId,
        status: 'Verifying Payment',
        notes: `VTpass returned status=${status || 'unknown'}; awaiting requery.`,
      });

      return { success: true, token, units, request_id, status: status || 'pending' };
    }

    logger.warn(`[PowerService][VTpass] Unexpected pay response: ${JSON.stringify(payload)}`);
    throw new Error(payload?.response_description || payload?.message || 'Vendor returned failure status');
  } catch (error) {
    const msg = error?.response?.data ? JSON.stringify(error.response.data) : error.message;
    logger.error(`[PowerService][VTpass] Vending FAILED: ${msg}`);

    await orderService.updateOrderStatus({
      orderId: String(orderIdOrMongoId),
      status: 'Vending Failed',
      notes: `Vending error: ${error.message}`,
    });

    throw error;
  }
};

/**
 * Transaction Status Requery (VTpass)
 */
const requeryVtpass = async (requestId) => {
  try {
    if (!requestId) throw new HttpError(400, 'request_id is required');

    const response = await axios.post(
      `${VTPASS_BASE_URL}/requery`,
      { request_id: String(requestId).trim() },
      { headers: vtpassHeadersForPost(), timeout: VTPASS_TIMEOUT_MS }
    );

    return response.data;
  } catch (error) {
    const msg = error?.response?.data ? JSON.stringify(error.response.data) : error.message;
    logger.error(`[PowerService][VTpass] Requery failed: ${msg}`);
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'Unable to requery transaction status');
  }
};

module.exports = { validateMeter, createPendingOrder, vendPower, requeryVtpass };