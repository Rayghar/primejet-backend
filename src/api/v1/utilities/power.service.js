// File: src/api/v1/utilities/power.service.js
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');
const orderService = require('../../orders/order.service'); 
const notificationService = require('../../notifications/notification.service');

// Configuration
const BASE_URL = process.env.VTPASS_BASE_URL || 'https://sandbox.vtpass.com/api';
const API_KEY = process.env.VTPASS_API_KEY;
const SECRET_KEY = process.env.VTPASS_SECRET_KEY;
const PUBLIC_KEY = process.env.VTPASS_PUBLIC_KEY;
const CONVENIENCE_FEE = parseFloat(process.env.POWER_CONVENIENCE_FEE || '100'); 
const TIMEOUT_MS = 25000; // 25 Seconds Hard Timeout

// --- MAPPING HELPERS ---
// VTpass expects "ikeja-electric", but frontend sends "ikeja_electric_prepaid"
const mapDiscoToVTpass = (frontendCode) => {
  const map = {
    'ikeja_electric_prepaid': 'ikeja-electric',
    'eko_electric_prepaid': 'eko-electric',
    'abuja_electric_prepaid': 'abuja-electric',
    'kano_electric_prepaid': 'kano-electric',
    'jos_electric_prepaid': 'jos-electric',
    'kaduna_electric_prepaid': 'kaduna-electric',
    'enugu_electric_prepaid': 'enugu-electric',
    'ibadan_electric_prepaid': 'ibadan-electric',
    'benin_electric_prepaid': 'benin-electric',
    'portharcourt_electric_prepaid': 'portharcourt-electric',
  };
  return map[frontendCode] || 'ikeja-electric'; // Default to Ikeja for safety
};

/**
 * HELPER: Force a request to fail if it takes too long
 * This prevents the "499" infinite hanging error.
 */
const withHardTimeout = (promise, ms) => {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`External API Timeout after ${ms}ms`));
    }, ms);
  });

  return Promise.race([
    promise.then((res) => {
      clearTimeout(timer);
      return res;
    }),
    timeoutPromise
  ]);
};

const getHeaders = () => ({
  'api-key': API_KEY,
  'secret-key': SECRET_KEY,
  'Content-Type': 'application/json'
});

/**
 * Step 1: Validate Meter (Merchant Verify)
 */
const validateMeter = async (meterNumber, discoCode, meterType) => {
  try {
    const serviceID = mapDiscoToVTpass(discoCode);
    const type = meterType || 'prepaid';

    logger.info(`[PowerService] Validating meter via VTpass: ${meterNumber} (${serviceID})`);
    
    // Use Hard Timeout Wrapper
    const response = await withHardTimeout(
      axios.post(`${BASE_URL}/merchant-verify`, {
        serviceID: serviceID, 
        billersCode: meterNumber,
        type: type 
      }, {
        headers: getHeaders()
      }),
      TIMEOUT_MS
    );

    // VTpass returns code "000" for success
    if (response.data && response.data.code === '000') {
      const details = response.data.content;
      return {
        isValid: true,
        name: details.Customer_Name || details.name || 'Unknown Name',
        address: details.Address || 'Address not provided',
        discoCode: discoCode, // Return original code to frontend
        meterNumber: meterNumber,
        meterType: type
      };
    } else {
      logger.warn(`[PowerService] VTpass validation failed: ${JSON.stringify(response.data)}`);
      // Extract error message from VTpass response if available
      const msg = response.data.response_description || 'Invalid Meter Number';
      throw new Error(msg);
    }
  } catch (error) {
    logger.error(`[PowerService] Meter validation error: ${error.message}`);
    // Return friendly error
    if (error.message.includes('Timeout')) {
      throw new HttpError(504, 'Provider is taking too long. Please try again.');
    }
    throw new HttpError(400, error.message || 'Unable to verify meter.');
  }
};

/**
 * Step 2: Create Pending Order
 */
const createPendingOrder = async (userId, data) => {
  const { meterNumber, discoCode, amount, phone, email, meterName, meterType } = data;

  const amountFloat = parseFloat(amount);
  const feeFloat = CONVENIENCE_FEE;
  const totalPayable = amountFloat + feeFloat;

  const newOrder = await orderService.placeOrder({
    user: { id: userId }, 
    body: {
        type: 'POWER', 
        orderItems: [], 
        totalAmount: totalPayable, 
        subTotal: amountFloat,     
        serviceFee: feeFloat,      
        deliveryFee: 0,
        status: 'Pending Payment',
        paymentStatus: 'Pending',
        metadata: {
            meterNumber,
            discoCode, // Store original frontend code
            vtpassServiceId: mapDiscoToVTpass(discoCode), // Store mapped ID
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
 * Step 3: Vend Token (The "Pay" Endpoint)
 */
const vendPower = async (orderId) => {
  logger.info(`[PowerService] Attempting to vend (VTpass) for Order: ${orderId}`);
  
  const order = await orderService.getOrder(orderId);
  if (!order) throw new Error('Order not found');
  
  if (['Completed', 'Delivered'].includes(order.status)) {
      return { success: true, token: order.metadata.get('token'), cached: true };
  }

  try {
    // Generate Request ID: YYYYMMDDHHMM + Random string
    const now = new Date();
    // Padding logic ensures request ID is always valid format
    const pad = (n) => n < 10 ? '0' + n : n;
    const requestId = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${uuidv4().substring(0,6)}`;

    // Calculate Amount (Exclude fee)
    const amountToVend = order.subTotal || (order.totalAmount - CONVENIENCE_FEE);
    
    // Prepare Payload
    const payload = {
      request_id: requestId,
      serviceID: order.metadata.get('vtpassServiceId') || mapDiscoToVTpass(order.metadata.get('discoCode')),
      billersCode: order.metadata.get('meterNumber'),
      variation_code: order.metadata.get('meterType') || 'prepaid',
      amount: amountToVend,
      phone: order.metadata.get('phone') || '08000000000'
    };

    logger.info(`[PowerService] VTpass Vending Payload: ${JSON.stringify(payload)}`);

    const response = await withHardTimeout(
      axios.post(`${BASE_URL}/pay`, payload, {
        headers: getHeaders()
      }),
      TIMEOUT_MS + 5000 // Give vending slightly more time than verify
    );

    const data = response.data;
    
    if (data && data.code === '000') {
      // Success Logic
      let token = 'TOKEN_GENERATED';
      let units = '0';

      if (data.token) token = data.token;
      if (data.mainToken) token = data.mainToken;
      if (data.units) units = data.units;
      
      // Handle nested transaction object if present
      if (data.content && data.content.transactions) {
         // Some VTpass responses bury the token here
      }

      // Update Order
      await orderService.updateOrderStatus(orderId, 'Completed', {
        token,
        units,
        vendorReference: data.requestId,
        vendorResponse: JSON.stringify(data)
      }, 'system');

      // Send Notification
      try {
        await notificationService.createAndSendNotification(
           order.user._id || order.user, 
           'Power Token Generated',
           `Token: ${token}`,
           { type: 'POWER_ORDER', orderId: orderId, token: token }
        );
      } catch (e) {}

      return { success: true, token, units };
    } 
    else if (data && data.code === '099') {
       throw new Error('Transaction Pending at Vendor. Please check back later.');
    }
    else {
      throw new Error(data.response_description || 'Vendor Transaction Failed');
    }

  } catch (error) {
    logger.error(`[PowerService] Vending FAILED: ${error.message}`);
    await orderService.updateOrderStatus(orderId, 'Vending Failed', {
      error: error.message
    }, 'system');
    throw error;
  }
};

module.exports = { validateMeter, createPendingOrder, vendPower };