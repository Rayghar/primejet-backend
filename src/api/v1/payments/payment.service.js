// File: src/api/v1/payments/payment.service.js
const crypto = require('crypto');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');
const orderService = require('../orders/order.service'); // Import the order service
const dotenv = require('dotenv');

dotenv.config();

// Make sure this MONNIFY_SECRET_KEY is loaded from environment variables in a real app
// For analysis, we will assume it's correctly loaded or hardcoded as per your request history for now.
const MONNIFY_SECRET_KEY = process.env.MONNIFY_SECRET_KEY || "2Z659QCSA4GCPR0VKTPQTB81A3R7XHK4"; // Hardcoded for analysis as requested, but recommend dotenv.

/**
 * Verifies the integrity of the Monnify webhook notification.
 * @param {string} signature - The value of the 'monnify-signature' header.
 * @param {string} rawBodyString - The raw request body as a string. IMPORTANT: This should be the raw string, not a parsed JSON object.
 * @returns {boolean} - True if the signature is valid, false otherwise.
 */
const verifySignature = (signature, rawBodyString) => {
  logger.debug('[Payment Service][verifySignature] Starting signature verification.');
  logger.debug(`[Payment Service][verifySignature] Received signature: ${signature}`);
  // logger.debug(`[Payment Service][verifySignature] Raw body string for hashing: ${rawBodyString}`); // Be careful logging sensitive data
  logger.debug(`[Payment Service][verifySignature] Using secret key (first 5 chars): ${MONNIFY_SECRET_KEY ? MONNIFY_SECRET_KEY.substring(0, 5) : 'N/A'}...`);


  if (!signature || !rawBodyString || !MONNIFY_SECRET_KEY) {
    logger.error('[Payment Service][verifySignature] Missing signature, rawBodyString, or secret key for verification. Cannot proceed.');
    return false;
  }
  // The hash is calculated using your secret key and the raw request body
  const hash = crypto
    .createHmac('sha512', MONNIFY_SECRET_KEY)
    .update(rawBodyString) // Use the raw body string here
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
    return;
  }

  // Determine the desired status for your order based on Monnify's paymentStatus
  let newOrderStatus = null;
  let newPaymentStatus = null;
  let finalAmountForOrder = 0; // Initialize with 0
  let updateNotes = '';

  if (paymentStatus === 'PAID') {
    newOrderStatus = 'Order Placed'; // Or 'Confirmed', 'Processing', etc. as per your business flow
    newPaymentStatus = 'Completed';
    finalAmountForOrder = amountPaid; // Monnify sends amountPaid in kobo
    updateNotes = `Payment successfully confirmed via Monnify webhook. Txn Ref: ${transactionReference}.`;
    logger.info(`[Payment Service][processWebhookEvent] Identified PAID status for order ${orderId}.`);
  } else if (paymentStatus === 'FAILED') {
    newOrderStatus = 'Failed'; // Or 'Payment Failed'
    newPaymentStatus = 'Failed';
    updateNotes = `Payment failed via Monnify webhook. Txn Ref: ${transactionReference}. Reason: ${responseMessage || 'N/A'}`;
    logger.warn(`[Payment Service][processWebhookEvent] Identified FAILED status for order ${orderId}.`);
  } else if (paymentStatus === 'CANCELLED') {
    newOrderStatus = 'Canceled by Customer'; // Or a more specific status
    newPaymentStatus = 'Failed'; // A cancelled payment is effectively a failed one
    updateNotes = `Payment cancelled by customer via Monnify webhook. Txn Ref: ${transactionReference}.`;
    logger.info(`[Payment Service][processWebhookEvent] Identified CANCELLED status for order ${orderId}.`);
  } else {
    logger.info(`[Payment Service][processWebhookEvent] Received unhandled Monnify payment status '${paymentStatus}' for order ${orderId}. No action defined for this status.`);
    return; // Don't proceed if no explicit action is defined for the status
  }

  const paymentDetails = {
    method: paymentMethod || 'Monnify', // e.g., 'CARD', 'ACCOUNT_TRANSFER'
    transactionId: transactionReference,
    amount: amountPaid, // Amount is already in the smallest unit (kobo) from Monnify
    paidAt: eventData.paidOn ? new Date(eventData.paidOn) : new Date(),
    monnifyStatus: paymentStatus,
    monnifyResponseMessage: responseMessage, // Capture Monnify's message
  };

  try {
    // Call your existing order service to securely update the order
    await orderService.updateOrderStatus({
      orderId: orderId,
      status: newOrderStatus, // Pass the new desired primary status
      paymentStatus: newPaymentStatus, // Pass the new desired payment status
      paymentDetails: paymentDetails,
      verifiedAmount: finalAmountForOrder, // Pass the amount verified by Monnify
      notes: updateNotes, // Pass the notes for status history
    });
    logger.info(`[Payment Service][processWebhookEvent] Order ${orderId} successfully processed and passed to order service for update.`);
  } catch (error) {
    logger.error(`[Payment Service][processWebhookEvent] Failed to call orderService.updateOrderStatus for order ${orderId}: ${error.message}`, { stack: error.stack, payload: eventData });
    // IMPORTANT: Do not re-throw here. Webhooks should ideally handle their own failures internally
    // and not return errors back to the payment gateway if a 200 OK has already been sent.
    // Use a dead-letter queue or alert system for critical failures here.
  }
};

/**
 * Main entry point for handling the webhook from the controller.
 * @param {object} params - The webhook parameters.
 * @param {string} params.signature - The 'monnify-signature' from the request header.
 * @param {string} params.rawBodyString - The raw request body as a string.
 */
const processMonnifyWebhook = async ({ signature, rawBodyString }) => {
  logger.info('[Payment Service] Starting Monnify webhook processing pipeline.');

  // 1. Verify the signature for security
  const isVerified = verifySignature(signature, rawBodyString);
  if (!isVerified) {
    logger.error('[Payment Service] Webhook signature verification failed. Aborting processing.');
    throw new HttpError('Invalid Monnify signature.', 401);
  }
  logger.info('[Payment Service] Webhook signature verified successfully. Proceeding to parse payload.');

  // 2. Parse the body and process the event
  let payload;
  try {
    payload = JSON.parse(rawBodyString);
  } catch (parseError) {
    logger.error(`[Payment Service] Failed to parse Monnify webhook raw body into JSON: ${parseError.message}`, { rawBody: rawBodyString });
    throw new HttpError('Invalid JSON payload.', 400);
  }

  const { eventType, eventData } = payload;
  logger.info(`[Payment Service] Parsed Monnify webhook payload. Event Type: ${eventType}. Payment Reference: ${eventData?.paymentReference}.`);
  logger.debug(`[Payment Service] Full Parsed Payload: ${JSON.stringify(payload)}`);


  // Pass eventType and eventData to the processing function.
  // This allows processWebhookEvent to handle different types based on your business logic.
  await processWebhookEvent(eventData, eventType);

  logger.info('[Payment Service] Monnify webhook processing pipeline completed.');
};

module.exports = {
  processMonnifyWebhook,
};