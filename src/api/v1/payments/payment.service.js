// File: src/api/v1/payments/payment.service.js
const crypto = require('crypto');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');
const orderService = require('../orders/order.service');
const dotenv = require('dotenv');

dotenv.config();

const MONNIFY_SECRET_KEY = process.env.MONNIFY_SECRET_KEY || "2Z659QCSA4GCPR0VKTPQTB81A3R7XHK4";

/**
 * Verifies the integrity of the Monnify webhook notification.
 * @param {string} signature - The value of the 'monnify-signature' header.
 * @param {string} rawBodyString - The raw request body as a string. IMPORTANT: This should be the raw string, not a parsed JSON object.
 * @returns {boolean} - True if the signature is valid, false otherwise.
 */
const verifySignature = (signature, rawBodyString) => {
  logger.debug('[Payment Service][verifySignature] Starting signature verification.');
  logger.debug(`[Payment Service][verifySignature] Received signature: ${signature}`);
  logger.debug(`[Payment Service][verifySignature] Using secret key (first 5 chars): ${MONNIFY_SECRET_KEY ? MONNIFY_SECRET_KEY.substring(0, 5) : 'N/A'}...`);


  if (!signature || !rawBodyString || !MONNIFY_SECRET_KEY) {
    logger.error('[Payment Service][verifySignature] Missing signature, rawBodyString, or secret key for verification. Cannot proceed.');
    return false;
  }
  // The hash is calculated using your secret key and the raw request body
  const hash = crypto
    .createHmac('sha512', MONNIFY_SECRET_KEY)
    .update(rawBodyString)
    .digest('hex');

  logger.debug(`[Payment Service][verifySignature] Computed hash: ${hash}`);

  const isSignatureValid = hash === signature;
  if (!isSignatureValid) {
    logger.warn(`[Payment Service][verifySignature] Signature Mismatch! Computed: ${hash}, Received: ${signature}.`);
  } else {
    logger.info('[Payment Service][verifySignature] Signature successfully verified.');
  }
  return isSignatureValid;
};

/**
 * Processes the validated webhook event from Monnify.
 * @param {object} eventData - The 'eventData' object from the Monnify payload.
 * @param {string} eventType - The 'eventType' string from the Monnify payload.
 * @throws {HttpError} If an error occurs during order update that should be propagated.
 */
const processWebhookEvent = async (eventData, eventType) => {
  logger.info(`[Payment Service][processWebhookEvent] Processing webhook event of type: ${eventType}`);
  logger.debug(`[Payment Service][processWebhookEvent] Event Data: ${JSON.stringify(eventData)}`);

  const { paymentReference, paymentStatus, transactionReference, amountPaid, paymentMethod, responseMessage } = eventData;

  // The 'paymentReference' from the SDK is your internal orderId
  const orderId = paymentReference;

  if (!orderId) {
    logger.warn('[Payment Service][processWebhookEvent] Webhook received without a paymentReference (orderId). Skipping processing for this eventData.', eventData);
    // Do NOT throw HttpError here as it's an async background process, just log and exit.
    // However, if processWebhookEvent is called directly and a valid orderId is expected, consider throwing.
    return;
  }

  // Determine the desired status for your order based on Monnify's paymentStatus
  let newOrderStatus = null;
  let newPaymentStatus = null;
  let finalAmountForOrder = 0; // Initialize with 0
  let updateNotes = '';

  if (paymentStatus === 'PAID') {
    newOrderStatus = 'Order Placed';
    newPaymentStatus = 'Completed';
    finalAmountForOrder = amountPaid;
    updateNotes = `Payment successfully confirmed via Monnify webhook. Txn Ref: ${transactionReference}.`;
    logger.info(`[Payment Service][processWebhookEvent] Identified PAID status for order ${orderId}.`);
  } else if (paymentStatus === 'FAILED') {
    newOrderStatus = 'Failed';
    newPaymentStatus = 'Failed';
    updateNotes = `Payment failed via Monnify webhook. Txn Ref: ${transactionReference}. Reason: ${responseMessage || 'N/A'}`;
    logger.warn(`[Payment Service][processWebhookEvent] Identified FAILED status for order ${orderId}.`);
  } else if (paymentStatus === 'CANCELLED') {
    newOrderStatus = 'Canceled by Customer';
    newPaymentStatus = 'Failed';
    updateNotes = `Payment cancelled by customer via Monnify webhook. Txn Ref: ${transactionReference}.`;
    logger.info(`[Payment Service][processWebhookEvent] Identified CANCELLED status for order ${orderId}.`);
  } else {
    logger.info(`[Payment Service][processWebhookEvent] Received unhandled Monnify payment status '${paymentStatus}' for order ${orderId}. No action defined for this status.`);
    return; // Don't proceed if no explicit action is defined for the status
  }

  const paymentDetails = {
    method: paymentMethod || 'Monnify',
    transactionId: transactionReference,
    amount: amountPaid,
    paidAt: eventData.paidOn ? new Date(eventData.paidOn) : new Date(),
    monnifyStatus: paymentStatus,
    monnifyResponseMessage: responseMessage,
  };

  try {
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
    logger.error(`[Payment Service][processWebhookEvent] Failed to call orderService.updateOrderStatus for order ${orderId}: ${error.message}`, { stack: error.stack, payload: eventData });
    // IMPORTANT: Re-throw HttpError or wrap generic errors to ensure controller sends correct status
    if (error instanceof HttpError) {
      // Ensure statusCode is an integer before re-throwing HttpError
      const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
      logger.error(`[Payment Service][processWebhookEvent] Propagating HttpError: ${statusCode} - ${error.message}`);
      throw new HttpError(statusCode, `Order update failed: ${error.message}`);
    } else {
      // For any other unexpected errors, wrap it in a generic HttpError 500
      logger.error(`[Payment Service][processWebhookEvent] Propagating unexpected error as HttpError 500: ${error.message}`);
      throw new HttpError(500, `An unexpected error occurred during order update: ${error.message}`);
    }
  }
};

/**
 * Main entry point for handling the webhook from the controller.
 * @param {object} params - The webhook parameters.
 * @param {string} params.signature - The 'monnify-signature' from the request header.
 * @param {string} params.rawBodyString - The raw request body as a string.
 * @throws {HttpError} If signature is invalid, payload is malformed, or processing fails.
 */
const processMonnifyWebhook = async ({ signature, rawBodyString }) => {
  logger.info('[Payment Service] Starting Monnify webhook processing pipeline.');

  // 1. Verify the signature for security
  const isVerified = verifySignature(signature, rawBodyString);
  if (!isVerified) {
    logger.error('[Payment Service] Webhook signature verification failed. Aborting processing.');
    throw new HttpError(401, 'Invalid Monnify signature.');
  }
  logger.info('[Payment Service] Webhook signature verified successfully. Proceeding to parse payload.');

  // 2. Parse the body and process the event
  let payload;
  try {
    payload = JSON.parse(rawBodyString);
  } catch (parseError) {
    logger.error(`[Payment Service] Failed to parse Monnify webhook raw body into JSON: ${parseError.message}`, { rawBody: rawBodyString });
    throw new HttpError(400, 'Invalid JSON payload.');
  }

  const { eventType, eventData } = payload;
  logger.info(`[Payment Service] Parsed Monnify webhook payload. Event Type: ${eventType}. Payment Reference: ${eventData?.paymentReference}.`);
  logger.debug(`[Payment Service] Full Parsed Payload: ${JSON.stringify(payload)}`);

  // Delegate processing to processWebhookEvent, which now handles its own error propagation
  await processWebhookEvent(eventData, eventType);

  logger.info('[Payment Service] Monnify webhook processing pipeline completed.');
};

module.exports = {
  processMonnifyWebhook,
};