// File: src/api/v1/payments/payment.service.js
const crypto = require('crypto');
const sha512 = require('js-sha512').sha512;
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');
const orderService = require('../orders/order.service'); 
const powerService = require('../utilities/power.service'); // ✅ Import Power Service
const dotenv = require('dotenv');

dotenv.config();

const MONNIFY_SECRET_KEY = process.env.MONNIFY_SECRET_KEY;

/**
 * Compute the Hash of the request body for security verification
 */
const computeMonnifyDocHash = (requestBodyString, secretKey) => {
  const result = sha512.hmac(secretKey, requestBodyString);
  logger.debug(`[Payment Service] Computed hash: ${result}`);
  return result;
};

/**
 * Verify that the webhook actually came from Monnify
 */
const verifyMonnifySignature = ({ signature, rawBodyString }) => {
  if (!signature || !rawBodyString || !MONNIFY_SECRET_KEY) {
    logger.error('[Payment Service] Missing verification parameters.');
    throw new HttpError(401, 'Missing required verification parameters.');
  }

  const computedHash = computeMonnifyDocHash(rawBodyString, MONNIFY_SECRET_KEY);

  if (computedHash !== signature) {
    logger.warn(`[Payment Service] Signature Mismatch! Computed: ${computedHash}, Received: ${signature}`);
    throw new HttpError(401, 'Invalid Monnify signature.');
  }
};

// Monnify paymentReference is configured by us. For gas orders we prefix: <orderId>_<timestamp>.
// Recover orderId safely (UUIDv4 expected).
const extractOrderIdFromPaymentReference = (paymentReference) => {
  const ref = (paymentReference || '').toString();
  const m = ref.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (m && m[0]) return m[0];
  if (ref.includes('_')) return ref.split('_')[0];
  return ref || null;
};


const orderId = extractOrderIdFromPaymentReference(paymentReference);


// 2. Fetch the Order to determine its TYPE (Gas vs Power)
let targetOrder = null;
try {
  // Internal system call: use admin context to satisfy getOrder authz.
  targetOrder = await orderService.getOrder(orderId, { id: 'system', role: 'admin' });
} catch (e) {
  logger.warn(`[Payment Service] Order ${orderId} not found. Skipping logic.`);
  return;
}


/**
 * Process the verified webhook event
 */
const processWebhookEvent = async (eventData, eventType) => {
  logger.info(`[Payment Service] Processing event: ${eventType}`);

  const { paymentReference, paymentStatus, transactionReference, amountPaid, paymentMethod, responseMessage } = eventData;
  
  // Extract Order ID (Assumes paymentReference is the Order ID or ORDERID_TIMESTAMP)
  const orderId = paymentReference.split('_')[0];

  logger.debug(`[Payment Service] Extracted Order ID: ${orderId}, Status: ${paymentStatus}`);

  if (!orderId) {
    throw new HttpError(400, 'Webhook payload missing order ID.');
  }

  // 1. Prepare Payment Details
  const paymentDetails = {
    method: paymentMethod || 'Monnify',
    transactionId: transactionReference,
    amount: amountPaid,
    paidAt: eventData.paidOn ? new Date(eventData.paidOn) : new Date(),
    monnifyStatus: paymentStatus,
    monnifyResponseMessage: responseMessage,
  };

  // 2. Fetch the Order to determine its TYPE (Gas vs Power)
  let targetOrder = null;
  try {
    targetOrder = await orderService.getOrder(orderId);
  } catch (e) {
    logger.warn(`[Payment Service] Order ${orderId} not found. Skipping logic.`);
    return; // Stop if order doesn't exist
  }

  // 3. Define Default Updates (for Gas/Delivery)
  let newOrderStatus = null;
  let newPaymentStatus = null;
  let finalAmountForOrder = amountPaid * 100; // Preserving your existing Kobo logic
  let updateNotes = '';

  switch (paymentStatus) {
    case 'PAID':
      newPaymentStatus = 'Completed';
      newOrderStatus = 'Order Placed'; // Default for Gas
      updateNotes = `Payment confirmed via Monnify. Ref: ${transactionReference}`;
      break;
    case 'FAILED':
      newPaymentStatus = 'Failed';
      newOrderStatus = 'Failed';
      updateNotes = `Payment failed. Reason: ${responseMessage}`;
      break;
    case 'CANCELLED':
      newPaymentStatus = 'Failed';
      newOrderStatus = 'Canceled';
      updateNotes = `Payment cancelled by customer.`;
      break;
    default:
      return; // Ignore other statuses
  }

  // ========================================================================
  // ⚡ POWER VENDING LOGIC (High Priority Intercept)
  // ========================================================================
  if (targetOrder && targetOrder.type === 'POWER') {
    if (paymentStatus === 'PAID') {
      logger.info(`[Payment Service] ⚡ Power Order detected (${orderId}). Initiating Vending...`);

      try {
        // A. Mark Payment as Completed FIRST (so we have record of money)
        await orderService.updateOrderStatus({
          orderId: orderId,
          status: 'Processing', // Show "Processing" while we vend
          paymentStatus: 'Completed',
          paymentDetails: paymentDetails,
          verifiedAmount: finalAmountForOrder,
          notes: `${updateNotes} [System] Initiating Electricity Vending.`,
        });

        // B. Trigger Vending (This handles the API call to Monnify/VTpass)
        const vendResult = await powerService.vendPower(orderId);
        
        logger.info(`[Payment Service] ✅ Vending Success for ${orderId}. Token: ${vendResult.token}`);
        
        // C. STOP HERE. 
        // We do NOT want to fall through to Gas logic (Driver Assignment).
        return; 

      } catch (powerError) {
        logger.error(`[Payment Service] 🚨 Vending Error: ${powerError.message}`);
        // The vendPower function usually sets status to 'Vending Failed' internally.
        // We return safely to acknowledge the webhook with 200 OK.
        return;
      }
    }
  }
  // ========================================================================

  // 4. Standard Gas/Delivery Order Update
  // This code only runs if it is NOT a Power order (or if payment failed)
  try {
    await orderService.updateOrderStatus({
      orderId: orderId,
      status: newOrderStatus,
      paymentStatus: newPaymentStatus,
      paymentDetails: paymentDetails,
      verifiedAmount: finalAmountForOrder,
      notes: updateNotes,
    });
    logger.info(`[Payment Service] Standard Order ${orderId} updated to ${newOrderStatus}`);
  } catch (error) {
    logger.error(`[Payment Service] Failed to update order ${orderId}: ${error.message}`);
    // Don't throw if it's just a status update fail, ensures webhook 200 OK
  }
};

/**
 * Entry point for Monnify Webhook
 */
const processMonnifyWebhook = async ({ signature, rawBodyString }) => {
  logger.info('[Payment Service] Webhook received.');
  
  // 1. Verify
  verifyMonnifySignature({ signature, rawBodyString });

  // 2. Parse
  let payload;
  try {
    payload = JSON.parse(rawBodyString);
  } catch (error) {
    throw new HttpError(400, 'Invalid JSON payload.');
  }

  // 3. Process
  const { eventType, eventData } = payload;
  if (eventType === 'SUCCESSFUL_TRANSACTION') {
      await processWebhookEvent(eventData, eventType);
  } else {
      logger.info(`[Payment Service] Ignoring event type: ${eventType}`);
  }
  
  logger.info('[Payment Service] Webhook processing complete.');
};

module.exports = {
  processMonnifyWebhook,
  verifyMonnifySignature,
};