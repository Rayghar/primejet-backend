// File: src/api/v1/payments/payment.service.js
const crypto = require('crypto');
const sha512 = require('js-sha512').sha512;
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');
const orderService = require('../orders/order.service'); // Keep this import for webhooks
const powerService = require('../utilities/power.service');
const dotenv = require('dotenv');

dotenv.config();

const MONNIFY_SECRET_KEY = process.env.MONNIFY_SECRET_KEY;

const computeMonnifyDocHash = (requestBodyString, secretKey) => {
  const result = sha512.hmac(secretKey, requestBodyString);
  logger.debug(`[Payment Service][computeMonnifyDocHash] Computed hash with js-sha512: ${result}`);
  return result;
};

const verifyMonnifySignature = ({ signature, rawBodyString }) => {
  logger.debug('[Payment Service][verifyMonnifySignature] Starting signature verification process.');
  logger.debug(`[Payment Service][verifyMonnifySignature] Received signature: ${signature}`);
  logger.debug(`[Payment Service][verifyMonnifySignature] Using secret key (first 5 chars): ${MONNIFY_SECRET_KEY ? MONNIFY_SECRET_KEY.substring(0, 5) : 'N/A'}...`);

  if (!signature || !rawBodyString || !MONNIFY_SECRET_KEY) {
    logger.error('[Payment Service][verifyMonnifySignature] Missing signature, rawBodyString, or secret key for verification. Aborting verification.');
    throw new HttpError(401, 'Missing required verification parameters.');
  }

  const stringToHash = rawBodyString;
  const computedHash = computeMonnifyDocHash(stringToHash, MONNIFY_SECRET_KEY);
  logger.debug(`[Payment Service][verifyMonnifySignature] Computed hash: ${computedHash}`);

  if (computedHash !== signature) {
    logger.warn(`[Payment Service][verifyMonnifySignature] Signature Mismatch detected! Computed: ${computedHash}, Received: ${signature}.`);
    logger.warn(`[Payment Service][verifyMonnifySignature] Check if your MONNIFY_SECRET_KEY matches the dashboard EXACTLY. Also check for subtle whitespace differences in the raw body sent by Monnify.`);
    throw new HttpError(401, 'Invalid Monnify signature.');
  }

  logger.info('[Payment Service][verifyMonnifySignature] Signature successfully verified.');
};

const processWebhookEvent = async (eventData, eventType) => {
  logger.info(`[Payment Service][processWebhookEvent] Processing webhook event of type: ${eventType}.`);
  logger.debug(`[Payment Service][processWebhookEvent] Full Event Data received: ${JSON.stringify(eventData)}`);

  const { paymentReference, paymentStatus, transactionReference, amountPaid, paymentMethod, responseMessage } = eventData;
  const orderId = paymentReference.split('_')[0];

  logger.debug(`[Payment Service][processWebhookEvent] Extracted: Order ID: ${orderId}, Payment Status: ${paymentStatus}, Transaction Ref: ${transactionReference}`);

  if (!orderId) {
    logger.warn('[Payment Service][processWebhookEvent] Webhook received without a paymentReference (orderId). Skipping processing for this eventData. Event Data:', eventData);
    throw new HttpError(400, 'Webhook payload missing order ID (paymentReference).');
  }

  let newOrderStatus = null;
  let newPaymentStatus = null;
  let finalAmountForOrder = 0;
  let updateNotes = '';

  switch (paymentStatus) {
    case 'PAID':
      newOrderStatus = 'Order Placed';
      newPaymentStatus = 'Completed';
      finalAmountForOrder = amountPaid * 100;
      updateNotes = `Payment successfully confirmed via Monnify webhook. Txn Ref: ${transactionReference}.`;
      logger.info(`[Payment Service][processWebhookEvent] Webhook indicates PAID status for order ${orderId}.`);
      break;
    case 'FAILED':
      newOrderStatus = 'Failed';
      newPaymentStatus = 'Failed';
      updateNotes = `Payment failed via Monnify webhook. Txn Ref: ${transactionReference}. Reason: ${responseMessage || 'N/A'}`;
      logger.warn(`[Payment Service][processWebhookEvent] Webhook indicates FAILED status for order ${orderId}.`);
      break;
    case 'CANCELLED':
      newOrderStatus = 'Canceled by Customer';
      newPaymentStatus = 'Failed';
      updateNotes = `Payment cancelled by customer via Monnify webhook. Txn Ref: ${transactionReference}.`;
      logger.info(`[Payment Service][processWebhookEvent] Webhook indicates CANCELLED status for order ${orderId}.`);
      break;
    default:
      logger.info(`[Payment Service][processWebhookEvent] Received unhandled Monnify payment status '${paymentStatus}' for order ${orderId}. No specific action defined.`);
      throw new HttpError(400, `Unhandled Monnify payment status: ${paymentStatus}.`);
  }

  const paymentDetails = {
    method: paymentMethod || 'Monnify',
    transactionId: transactionReference,
    amount: amountPaid,
    paidAt: eventData.paidOn ? new Date(eventData.paidOn) : new Date(),
    monnifyStatus: paymentStatus,
    monnifyResponseMessage: responseMessage,
  };

  // --- START: Power Integration Logic ---
  // We must determine if this is a GAS order or a POWER order before proceeding.
  // Power orders require vending; Gas orders require delivery fulfillment.
  let targetOrder = null;
  try {
    targetOrder = await orderService.getOrder(orderId);
  } catch (e) {
    logger.warn(`[Payment Service] Could not fetch order ${orderId} for type check. Proceeding as standard order.`);
  }

  if (targetOrder && targetOrder.type === 'POWER') {
    if (paymentStatus === 'PAID') {
      logger.info(`[Payment Service] POWER Order detected (${orderId}). Initiating Vending Sequence.`);
      
      try {
        // 1. Mark Payment as Completed & Status as Processing (Vending in progress)
        await orderService.updateOrderStatus({
          orderId: orderId,
          status: 'Processing', 
          paymentStatus: 'Completed',
          paymentDetails: paymentDetails,
          verifiedAmount: finalAmountForOrder,
          notes: updateNotes + ' [System] Initiating Electricity Vending.',
        });

        // 2. Trigger Vending Service
        // This will call the Utility API (Baxi) and update status to 'Completed' (with Token) or 'Vending Failed'
        await powerService.vendPower(orderId);
        
        logger.info(`[Payment Service] Vending sequence triggered successfully for ${orderId}.`);
        return; // EXIT HERE: Do not proceed to standard Gas logic
      } catch (powerError) {
        logger.error(`[Payment Service] Error during Power processing loop: ${powerError.message}`);
        // We do not throw here to avoid crashing the webhook response, 
        // as the order status likely has been updated to 'Vending Failed' inside vendPower if applicable.
        return;
      }
    }
  }
  // --- END: Power Integration Logic ---

  try {
    logger.debug(`[Payment Service][processWebhookEvent] Calling orderService.updateOrderStatus with: Order ID: ${orderId}, New Status: ${newOrderStatus}, New Payment Status: ${newPaymentStatus}, Verified Amount: ${finalAmountForOrder}, Notes: ${updateNotes}.`);
    await orderService.updateOrderStatus({
      orderId: orderId,
      status: newOrderStatus,
      paymentStatus: newPaymentStatus,
      paymentDetails: paymentDetails,
      verifiedAmount: finalAmountForOrder,
      notes: updateNotes,
    });
    logger.info(`[Payment Service][processWebhookEvent] Order ${orderId} successfully processed and passed to order service for update.`);
  } catch (error) {
    logger.error(`[Payment Service][processWebhookEvent] Error calling orderService.updateOrderStatus for order ${orderId}: ${error.message}`, { stack: error.stack, payload: eventData });

    if (error instanceof HttpError) {
      const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
      logger.error(`[Payment Service][processWebhookEvent] Propagating HttpError from order service: ${statusCode} - ${error.message}`);
      throw new HttpError(statusCode, `Order update failed: ${error.message}`);
    } else {
      logger.error(`[Payment Service][processWebhookEvent] Propagating unexpected non-HttpError from order service as HttpError 500: ${error.message}`);
      throw new HttpError(500, `An unexpected error occurred during order update: ${error.message}`);
    }
  }
};

const processMonnifyWebhook = async ({ signature, rawBodyString }) => {
  logger.info('[Payment Service] Starting Monnify webhook processing pipeline.');
  logger.debug('[Payment Service] Received params for processMonnifyWebhook:', { signature, rawBodyString: rawBodyString.substring(0, 100) + '...' });

  verifyMonnifySignature({ signature, rawBodyString });
  logger.info('[Payment Service] Webhook signature verified successfully. Proceeding to parse payload.');

  let payload;
  try {
    payload = JSON.parse(rawBodyString);
    logger.debug('[Payment Service] Raw body parsed successfully into JSON payload.');
  } catch (parseError) {
    logger.error(`[Payment Service] Failed to parse Monnify webhook raw body into JSON: ${parseError.message}`, { rawBody: rawBodyString });
    throw new HttpError(400, 'Invalid JSON payload.');
  }

  const { eventType, eventData } = payload;
  logger.info(`[Payment Service] Parsed Monnify webhook payload. Event Type: ${eventType}. Payment Reference: ${eventData?.paymentReference}.`);
  logger.debug(`[Payment Service] Full Parsed Payload: ${JSON.stringify(payload)}`);

  await processWebhookEvent(eventData, eventType);
  logger.info('[Payment Service] Monnify webhook processing pipeline completed.');
};

// FIX: Removed the initializePayment function from here.
// It has been moved to order.service.js to break the circular dependency.

module.exports = {
  processMonnifyWebhook,
  verifyMonnifySignature,
  // FIX: Removed the export of initializePayment
};