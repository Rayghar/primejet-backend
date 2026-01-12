// File: src/api/v1/utilities/power.service.js
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');
const orderService = require('../orders/order.service');
const notificationService = require('../notifications/notification.service');
// ✅ CRITICAL: Import Order model directly to bypass service-layer auth checks during webhook/vending
const Order = require('../../../models/order.model'); 

// Configuration
const BAXI_URL = process.env.BAXI_BASE_URL || 'https://api.baxibap.com/services/electricity';
const BAXI_TOKEN = process.env.BAXI_API_TOKEN;
const BAXI_AGENT_ID = process.env.BAXI_AGENT_ID;
const CONVENIENCE_FEE = parseFloat(process.env.POWER_CONVENIENCE_FEE || '100'); 

/**
 * Step 1: Validate Meter via Baxi
 */
const validateMeter = async (meterNumber, discoCode, meterType) => {
  try {
    logger.info(`[PowerService] Validating meter: ${meterNumber} (${discoCode})`);
    
    const response = await axios.post(`${BAXI_URL}/verify`, {
      service_type: discoCode,
      account_number: meterNumber,
    }, {
      headers: { 
        'Authorization': `Api-Key ${BAXI_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.data && response.data.status === 'success') {
      return {
        isValid: true,
        name: response.data.data.name,
        address: response.data.data.address,
        discoCode: discoCode,
        meterNumber: meterNumber
      };
    } else {
      throw new Error('Verification returned unsuccessful status');
    }
  } catch (error) {
    logger.error(`[PowerService] Meter validation failed: ${error.message}`);
    throw new HttpError(400, 'Unable to verify meter details. Please check the number and Disco.');
  }
};

/**
 * Step 2: Create Pending Order
 * ✅ FIX: Matched signature to orderService.placeOrder(customerId, data)
 */
const createPendingOrder = async (userId, data) => {
  const { meterNumber, discoCode, amount, phone, email, meterName } = data;

  const amountKobo = parseFloat(amount) * 100;
  const feeKobo = CONVENIENCE_FEE * 100;
  const totalPayableKobo = amountKobo + feeKobo;

  logger.info(`[PowerService] Creating Power Order. Amount: ${amount}, Fee: ${CONVENIENCE_FEE}`);

  // Create Order via OrderService
  // We pass 'subTotal' as the actual electricity amount to vend later
  const newOrder = await orderService.placeOrder(userId, {
      type: 'POWER', 
      items: [], 
      totalAmount: totalPayableKobo / 100, // User pays this
      subTotal: parseFloat(amount),        // We vend this
      serviceFee: CONVENIENCE_FEE,         // We keep this
      deliveryFee: 0,
      status: 'Pending Payment',
      paymentStatus: 'Pending',
      metadata: {
          meterNumber,
          discoCode,
          meterName,
          phone,
          email,
          units: '0'
      }
  });

  return newOrder.order; // placeOrder returns { order, ... }
};

/**
 * Step 3: Vend Token (After Payment)
 * ✅ FIX: Uses Order.findOne to avoid 401 Auth error from service
 * ✅ FIX: Uses Map .get()/.set() for metadata
 * ✅ FIX: Uses correct object signature for updateOrderStatus
 */
const vendPower = async (orderId) => {
  logger.info(`[PowerService] Attempting to vend power for Order: ${orderId}`);
  
  // Direct DB access to bypass "requestingUser" check in order.service.js
  const order = await Order.findOne({ id: orderId });
  if (!order) throw new Error('Order not found');
  
  // Idempotency Check
  if (['Completed', 'Delivered'].includes(order.status)) {
      logger.warn(`[PowerService] Order ${orderId} already completed.`);
      // Safe access to map
      const token = order.metadata ? order.metadata.get('token') : null;
      return { success: true, token, cached: true };
  }

  try {
    const requestId = `v_${uuidv4().substring(0, 12)}`; 
    
    // Handle Mongoose Map access
    const discoCode = order.metadata.get('discoCode');
    const meterNumber = order.metadata.get('meterNumber');
    const phone = order.metadata.get('phone') || '08000000000';

    // Vend only electricity amount
    const amountToVend = order.subTotal || (order.grandTotal - CONVENIENCE_FEE);

    const response = await axios.post(`${BAXI_URL}/request`, {
      service_type: discoCode,
      account_number: meterNumber,
      amount: amountToVend, 
      phone: phone,
      agentId: BAXI_AGENT_ID,
      agentReference: requestId
    }, {
      headers: { 'Authorization': `Api-Key ${BAXI_TOKEN}` }
    });

    if (response.data && response.data.status === 'success') {
      const token = response.data.data.tokenCode || response.data.data.token;
      const units = response.data.data.units;

      // 1. Manually update Metadata (Map) as updateOrderStatus doesn't handle arbitrary fields
      if (!order.metadata) order.metadata = new Map();
      order.metadata.set('token', token.toString());
      order.metadata.set('units', units.toString());
      order.metadata.set('vendorReference', response.data.data.transactionReference);
      await order.save();

      // 2. Update Status using Service (for history/notifications)
      await orderService.updateOrderStatus({
        orderId: orderId,
        status: 'Completed',
        paymentStatus: 'Completed',
        notes: `Vending Successful. Token generated.`,
        verifiedAmount: order.finalAmountPaid // maintain consistency
      });

      // 3. Send Notification
      try {
        await notificationService.createAndSendNotification(
           order.customerId, 
           'Power Token Generated',
           `Your token is: ${token} (${units}kWh).`,
           'POWER_ORDER',
           { orderId: orderId, token: token }
        );
      } catch (e) {
        logger.warn(`[PowerService] Notification failed: ${e.message}`);
      }

      logger.info(`[PowerService] Vending Successful! Token: ${token}`);
      return { success: true, token, units };
    } else {
      throw new Error(response.data.message || 'Vendor returned failure status');
    }

  } catch (error) {
    logger.error(`[PowerService] Vending FAILED: ${error.message}`);
    
    // Update status to Failed
    await orderService.updateOrderStatus({
      orderId: orderId,
      status: 'Vending Failed',
      notes: `Vending error: ${error.message}`
    });
    
    throw error;
  }
};

module.exports = { validateMeter, createPendingOrder, vendPower };