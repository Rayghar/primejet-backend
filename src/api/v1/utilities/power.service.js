// File: src/api/v1/utilities/power.service.js
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');
const orderService = require('../../orders/order.service'); 

// Configuration
// Sandbox: https://sandbox.monnify.com
// Live: https://api.monnify.com
const BASE_URL = 'https://sandbox.monnify.com' //process.env.MONNIFY_BASE_URL || 'https://sandbox.monnify.com';
const API_KEY = process.env.MONNIFY_API_KEY;
const SECRET_KEY = process.env.MONNIFY_SECRET_KEY;
const CONVENIENCE_FEE = parseFloat(process.env.POWER_CONVENIENCE_FEE || '100'); 

// --- MONNIFY HELPERS ---

/**
 * Map Frontend Disco Codes to Monnify Product Codes.
 * These codes (e.g. "MOB_PREPAID_IKEJA") are specific to Monnify.
 * You can verify these by calling GET /api/v1/vas/bills-payment/billers via Postman.
 */
const mapDiscoToMonnifyCode = (code, type = 'prepaid') => {
  // Normalize type
  const isPrepaid = type.toLowerCase().includes('prepaid');
  
  // Mapping Table (Sandbox/Live standard codes)
  const map = {
    'ikeja_electric': isPrepaid ? 'MOB_PREPAID_IKEJA' : 'MOB_POSTPAID_IKEJA',
    'eko_electric': isPrepaid ? 'MOB_PREPAID_EKO' : 'MOB_POSTPAID_EKO',
    'abuja_electric': isPrepaid ? 'MOB_PREPAID_ABUJA' : 'MOB_POSTPAID_ABUJA',
    'ibadan_electric': isPrepaid ? 'MOB_PREPAID_IBADAN' : 'MOB_POSTPAID_IBADAN',
    'enugu_electric': isPrepaid ? 'MOB_PREPAID_ENUGU' : 'MOB_POSTPAID_ENUGU',
    'jos_electric': isPrepaid ? 'MOB_PREPAID_JOS' : 'MOB_POSTPAID_JOS',
    'kano_electric': isPrepaid ? 'MOB_PREPAID_KANO' : 'MOB_POSTPAID_KANO',
    'portharcourt_electric': isPrepaid ? 'MOB_PREPAID_PH' : 'MOB_POSTPAID_PH',
    // Aliases for frontend "legacy" codes
    'ikeja_electric_prepaid': 'MOB_PREPAID_IKEJA',
    'eko_electric_prepaid': 'MOB_PREPAID_EKO',
    'abuja_electric_prepaid': 'MOB_PREPAID_ABUJA',
  };

  return map[code] || 'MOB_PREPAID_IKEJA'; // Fallback
};

/**
 * Get Access Token (Basic Auth)
 * Monnify Token expires in 60 mins. We fetch a new one for each major op for simplicity.
 */
const getAccessToken = async () => {
  try {
    if (!API_KEY || !SECRET_KEY) throw new Error("Monnify API Key/Secret missing");
    
    const authString = Buffer.from(`${API_KEY}:${SECRET_KEY}`).toString('base64');
    const response = await axios.post(
      `${BASE_URL}/api/v1/auth/login`,
      {},
      { headers: { 'Authorization': `Basic ${authString}` } }
    );
    
    if (response.data.requestSuccessful && response.data.responseBody.accessToken) {
      return response.data.responseBody.accessToken;
    }
    throw new Error('Failed to retrieve access token from Monnify');
  } catch (error) {
    logger.error(`[Monnify] Auth Failed: ${error.message}`);
    throw new Error('Service authentication failed');
  }
};

// --- CORE FUNCTIONS ---

/**
 * Step 1: Validate Meter
 * Returns customer name & address.
 */
const validateMeter = async (meterNumber, discoCode, meterType = 'prepaid') => {
  try {
    const token = await getAccessToken();
    // In Monnify validation, you often use the generic validation endpoint
    // or specific product lookup. 
    // Endpoint: POST /api/v1/vas/bills-payment/validate-customer
    
    // Note: Monnify validation requires a "Biller Code" or "Product Code".
    // We use the product code mapped above.
    const productCode = mapDiscoToMonnifyCode(discoCode, meterType);

    logger.info(`[Power] Validating Meter: ${meterNumber} on ${productCode}`);

    const response = await axios.post(
      `${BASE_URL}/api/v1/vas/bills-payment/validate-customer`,
      {
        productCode: productCode,
        customerKey: meterNumber
      },
      { headers: { 'Authorization': `Bearer ${token}` } }
    );

    const body = response.data;
    if (body.requestSuccessful) {
      const data = body.responseBody;
      return {
        isValid: true,
        name: data.name || data.customerName || "Customer",
        address: data.address || "Address Not Provided",
        meterNumber: meterNumber,
        discoCode: discoCode,
        // Validation Reference is rarely needed for *Electricity* on Monnify (unlike VTpass)
        // but we return it just in case.
        validationReference: data.validationReference 
      };
    } else {
      throw new Error(body.responseMessage || 'Meter validation failed');
    }

  } catch (error) {
    logger.error(`[Power] Validation Error: ${error.message}`);
    const msg = error.response?.data?.responseMessage || error.message;
    throw new HttpError(400, `Validation Failed: ${msg}`);
  }
};

/**
 * Step 2: Create Pending Order
 * Adds Convenience Fee here.
 */
const createPendingOrder = async (userId, data) => {
  const { meterNumber, discoCode, amount, phone, email, meterName, meterType } = data;

  const electricityAmount = parseFloat(amount);
  const totalPayable = electricityAmount + CONVENIENCE_FEE;

  // Create Order in DB
  const newOrder = await orderService.placeOrder({
    user: { id: userId }, 
    body: {
        type: 'POWER', 
        orderItems: [], 
        totalAmount: totalPayable, // User Pays (e.g. 2100)
        subTotal: electricityAmount,   // Vending Amount (e.g. 2000)
        serviceFee: CONVENIENCE_FEE,   // Fee (e.g. 100)
        deliveryFee: 0,
        status: 'Pending Payment',
        paymentStatus: 'Pending',
        metadata: {
            meterNumber,
            discoCode,
            productCode: mapDiscoToMonnifyCode(discoCode, meterType),
            meterType: meterType || 'prepaid',
            meterName,
            phone,
            email
        }
    }
  });

  return newOrder;
};

/**
 * Step 3: Vend Token (Called by Webhook)
 */
const vendPower = async (orderId) => {
  logger.info(`[Monnify] Vending Power for Order: ${orderId}`);
  
  const order = await orderService.getOrder(orderId);
  if (!order) throw new Error('Order not found');
  
  // Idempotency
  if (['Completed', 'Delivered'].includes(order.status)) {
      return { success: true, token: order.metadata.get('token'), cached: true };
  }

  try {
    const token = await getAccessToken();
    const requestRef = `${Date.now()}-${uuidv4().substring(0,4)}`;

    // Payload for POST /api/v1/vas/bills-payment/vend
    const payload = {
        batchReference: requestRef,
        requestReference: requestRef,
        productCode: order.metadata.get('productCode'), // "MOB_PREPAID_IKEJA"
        customerKey: order.metadata.get('meterNumber'),
        amount: order.subTotal, // Vend the electricity amount (2000), not total
        clientReference: requestRef,
        // user details
        email: order.metadata.get('email') || "customer@primejet.com",
        phone: order.metadata.get('phone') || "08000000000"
    };

    logger.info(`[Monnify] Sending Vend Request: ${JSON.stringify(payload)}`);

    const response = await axios.post(
        `${BASE_URL}/api/v1/vas/bills-payment/vend`,
        payload,
        { headers: { 'Authorization': `Bearer ${token}` } }
    );

    const body = response.data;

    if (body.requestSuccessful) {
        const vendData = body.responseBody;
        
        // Extract Token: Monnify usually returns it in 'token' or 'pin' or 'standardToken'
        // If it's empty, check the transaction object
        const tokenCode = vendData.token || vendData.pin || vendData.standardToken || "TOKEN_GENERATED";
        const units = vendData.units || "0";

        // Update Order
        await orderService.updateOrderStatus(orderId, 'Completed', {
            token: tokenCode,
            units: units,
            vendorReference: vendData.transactionReference,
            vendorResponse: JSON.stringify(vendData)
        }, 'system');

        // Optional: Send Push Notification here
        try {
           await notificationService.createAndSendNotification(
             order.user._id || order.user, 
             'Power Token Generated',
             `Token: ${tokenCode}`,
             { type: 'POWER_ORDER', orderId: orderId, token: tokenCode }
           );
        } catch(e) {}

        return { success: true, token: tokenCode, units };
    } else {
        throw new Error(body.responseMessage || 'Monnify vending failed');
    }

  } catch (error) {
    logger.error(`[Monnify] Vending FAILED: ${error.message}`);
    
    const failReason = error.response?.data?.responseMessage || error.message;
    await orderService.updateOrderStatus(orderId, 'Vending Failed', {
      error: failReason
    }, 'system');
    
    throw error;
  }
};

module.exports = { validateMeter, createPendingOrder, vendPower };