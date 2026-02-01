// File: src/api/v1/utilities/power.service.js
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');
const orderService = require('../../orders/order.service'); 
const notificationService = require('../../notifications/notification.service');

// Configuration
// Sandbox: https://sandbox.monnify.com
// Live: https://api.monnify.com
const BASE_URL = process.env.MONNIFY_BASE_URL || 'https://sandbox.monnify.com';
const API_KEY = process.env.MONNIFY_API_KEY;
const SECRET_KEY = process.env.MONNIFY_SECRET_KEY;
const CONVENIENCE_FEE = parseFloat(process.env.POWER_CONVENIENCE_FEE || '100'); 

// Timeouts
const HTTP_TIMEOUT = 30000; // 30 Seconds

// --- HELPERS ---

/**
 * Map Frontend Disco Codes to Monnify Product Codes.
 */
const mapDiscoToMonnifyCode = (code, type = 'prepaid') => {
  const isPrepaid = type.toLowerCase().includes('prepaid');
  
  const map = {
    'ikeja_electric_prepaid': 'MOB_PREPAID_IKEJA',
    'eko_electric_prepaid': 'MOB_PREPAID_EKO',
    'abuja_electric_prepaid': 'MOB_PREPAID_ABUJA',
    'ibadan_electric_prepaid': 'MOB_PREPAID_IBADAN',
    'enugu_electric_prepaid': 'MOB_PREPAID_ENUGU',
    'jos_electric_prepaid': 'MOB_PREPAID_JOS',
    'kano_electric_prepaid': 'MOB_PREPAID_KANO',
    'portharcourt_electric_prepaid': 'MOB_PREPAID_PH',
    
    // Direct matches if frontend sends raw Monnify codes
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
    
    if (!API_KEY || !SECRET_KEY) throw new Error("Monnify API Key/Secret missing in .env");
    
    const authString = Buffer.from(`${API_KEY}:${SECRET_KEY}`).toString('base64');
    
    const response = await axios.post(
      `${BASE_URL}/api/v1/auth/login`,
      {},
      { 
        headers: { 'Authorization': `Basic ${authString}` },
        timeout: HTTP_TIMEOUT 
      }
    );
    
    if (response.data.requestSuccessful && response.data.responseBody.accessToken) {
      logger.info('[Monnify] Auth Successful.');
      return response.data.responseBody.accessToken;
    }
    
    throw new Error('No access token in response');
  } catch (error) {
    logger.error(`[Monnify] Auth Failed: ${error.message}`);
    throw new Error('Service authentication failed. Please check server logs.');
  }
};

// --- CORE FUNCTIONS ---

/**
 * Step 1: Validate Meter
 */
const validateMeter = async (meterNumber, discoCode, meterType = 'prepaid') => {
  try {
    // 1. Auth
    const token = await getAccessToken();
    
    // 2. Map Code
    const productCode = mapDiscoToMonnifyCode(discoCode, meterType);
    logger.info(`[Monnify] Validating Meter: ${meterNumber} on ${productCode}`);

    // 3. Request
    const response = await axios.post(
      `${BASE_URL}/api/v1/vas/bills-payment/validate-customer`,
      {
        productCode: productCode,
        customerKey: meterNumber
      },
      { 
        headers: { 'Authorization': `Bearer ${token}` },
        timeout: HTTP_TIMEOUT,
        validateStatus: () => true // Prevent crashing on 400/500
      }
    );

    const body = response.data;

    // 4. Handle Response
    if (body.requestSuccessful) {
      const data = body.responseBody;
      logger.info(`[Monnify] Validation Success: ${data.name}`);
      return {
        isValid: true,
        name: data.name || data.customerName || "Customer",
        address: data.address || "Address Not Provided",
        meterNumber: meterNumber,
        discoCode: discoCode,
        validationReference: data.validationReference 
      };
    } else {
      logger.warn(`[Monnify] Validation Logic Fail: ${body.responseMessage}`);
      throw new Error(body.responseMessage || 'Meter validation failed');
    }

  } catch (error) {
    logger.error(`[Monnify] Validation Exception: ${error.message}`);
    const msg = error.response?.data?.responseMessage || error.message;
    
    if (msg.includes('timeout')) {
      throw new HttpError(504, 'Provider took too long to respond. Try again.');
    }
    throw new HttpError(400, `Validation Failed: ${msg}`);
  }
};

/**
 * Step 2: Create Pending Order
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
        totalAmount: totalPayable, 
        subTotal: electricityAmount,   
        serviceFee: CONVENIENCE_FEE,   
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

    const payload = {
        batchReference: requestRef,
        requestReference: requestRef,
        productCode: order.metadata.get('productCode'), 
        customerKey: order.metadata.get('meterNumber'),
        amount: order.subTotal, 
        clientReference: requestRef,
        email: order.metadata.get('email') || "customer@primejet.com",
        phone: order.metadata.get('phone') || "08000000000"
    };

    logger.info(`[Monnify] Sending Vend Request...`);

    const response = await axios.post(
        `${BASE_URL}/api/v1/vas/bills-payment/vend`,
        payload,
        { 
          headers: { 'Authorization': `Bearer ${token}` },
          timeout: 45000 // Give vending a bit more time
        }
    );

    const body = response.data;

    if (body.requestSuccessful) {
        const vendData = body.responseBody;
        const tokenCode = vendData.token || vendData.pin || vendData.standardToken || "TOKEN_GENERATED";
        const units = vendData.units || "0";

        // Update Order
        await orderService.updateOrderStatus(orderId, 'Completed', {
            token: tokenCode,
            units: units,
            vendorReference: vendData.transactionReference,
            vendorResponse: JSON.stringify(vendData)
        }, 'system');

        // Optional: Send Notification
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