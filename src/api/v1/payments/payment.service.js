// File: src/api/v1/payments/payment.service.js
const crypto = require('crypto'); // Kept for potential other uses, but not for hashing
const sha512 = require('js-sha512').sha512; // Added import: Monnify recommends js-sha512 for exact hashing match
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');
const orderService = require('../orders/order.service');
const dotenv = require('dotenv');

dotenv.config();

const MONNIFY_SECRET_KEY = process.env.MONNIFY_SECRET_KEY || "2Z659QCSA4GCPR0VKTPQTB81A3R7XHK4";

// --- Monnify's Sample Data for Static Hashing Test (for extreme debugging only) ---
// This static string is used to compare your computed hash against Monnify's documented hash.
const MONNIFY_DOC_SAMPLE_REQUEST_BODY = '{"eventData":{"product":{"reference":"111222333","type":"OFFLINE_PAYMENT_AGENT"},"transactionReference":"MNFY |76|20211117154810|000001","paymentReference":"0.01462001097368737","paidOn":"17/11/2021 3:48:10 PM","paymentDescription":"Mockaroo Jesse", "metaData":{},"destinationAccountInformation":{},"paymentSourceInformation":{},"amountPaid":78000,"totalPayable":78000,"offlineProductInformation":{"code":"41470","type":"DYNAMIC"},"cardDetails":{},"paymentMethod":"CASH", "currency":"NGN", "settlementAmount":77600,"paymentStatus":"PAID", "customer":{"name":"Mockaroo Jesse","email":"111222333@ZZAMZ4WT4Y3E.monnify"}},"eventType":"SUCCESSFUL_TRANSACTION"}'; //

// --- Hashing Function using js-sha512 (as per Monnify's documentation) ---
// This function will be used for the actual signature verification.
const computeMonnifyDocHash = (requestBodyString, secretKey) => {
  // Uses sha512.hmac from the js-sha512 library as per Monnify's example.
  const result = sha512.hmac(secretKey, requestBodyString);
  logger.debug(`[Payment Service][computeMonnifyDocHash] Computed hash with js-sha512: ${result}`);
  return result;
};

/**
 * Verifies the integrity of the Monnify webhook notification.
 * @param {string} signature - The value of the 'monnify-signature' header.
 * @param {string} rawBodyString - The raw request body as a string.
 * @throws {HttpError} If the signature is invalid.
 */
const verifyMonnifySignature = ({ signature, rawBodyString }) => {
  logger.debug('[Payment Service][verifyMonnifySignature] Starting signature verification process.');
  logger.debug(`[Payment Service][verifyMonnifySignature] Received signature: ${signature}`);
  logger.debug(`[Payment Service][verifyMonnifySignature] Using secret key (first 5 chars): ${MONNIFY_SECRET_KEY ? MONNIFY_SECRET_KEY.substring(0, 5) : 'N/A'}...`);

  if (!signature || !rawBodyString || !MONNIFY_SECRET_KEY) {
    logger.error('[Payment Service][verifyMonnifySignature] Missing signature, rawBodyString, or secret key for verification. Aborting verification.');
    throw new HttpError(401, 'Missing required verification parameters.');
  }

  // >>> DEBUG OVERRIDE for rawBodyString (TEMPORARY - REMOVE IN PRODUCTION!) <<<
  // If you want to test the hashing with Monnify's exact sample string:
  // const stringToHash = MONNIFY_DOC_SAMPLE_REQUEST_BODY;
  // logger.warn('[Payment Service][verifyMonnifySignature] DEBUG MODE ACTIVE: Using hardcoded Monnify sample raw body for hashing!');
  // >>> END DEBUG OVERRIDE <<<

  // Use the dynamically received rawBodyString for live verification
  const stringToHash = rawBodyString;

  // Use the computeMonnifyDocHash function which uses js-sha512
  const computedHash = computeMonnifyDocHash(stringToHash, MONNIFY_SECRET_KEY);

  logger.debug(`[Payment Service][verifyMonnifySignature] Computed hash: ${computedHash}`);

  if (computedHash !== signature) {
    logger.warn(`[Payment Service][verifyMonnifySignature] Signature Mismatch detected! Computed: ${computedHash}, Received: ${signature}.`);
    logger.warn(`[Payment Service][verifyMonnifySignature] Check if your MONNIFY_SECRET_KEY matches the dashboard EXACTLY. Also check for subtle whitespace differences in the raw body sent by Monnify.`);
    throw new HttpError(401, 'Invalid Monnify signature.');
  }

  logger.info('[Payment Service][verifyMonnifySignature] Signature successfully verified.');
};

/**
 * Processes the validated webhook event from Monnify.
 * @param {object} eventData - The 'eventData' object from the Monnify payload.
 * @param {string} eventType - The 'eventType' string from the Monnify payload.
 * @throws {HttpError} If an error occurs during order update that should be propagated.
 */
const processWebhookEvent = async (eventData, eventType) => {
  logger.info(`[Payment Service][processWebhookEvent] Processing webhook event of type: ${eventType}.`);
  logger.debug(`[Payment Service][processWebhookEvent] Full Event Data received: ${JSON.stringify(eventData)}`);

  const { paymentReference, paymentStatus, transactionReference, amountPaid, paymentMethod, responseMessage } = eventData;
  const orderId = paymentReference;

  logger.debug(`[Payment Service][processWebhookEvent] Extracted: Order ID: ${orderId}, Payment Status: ${paymentStatus}, Transaction Ref: ${transactionReference}`);

  if (!orderId) {
    logger.warn('[Payment Service][processWebhookEvent] Webhook received without a paymentReference (orderId). Skipping processing for this eventData. Event Data:', eventData);
    throw new HttpError(400, 'Webhook payload missing order ID (paymentReference).'); // Throwing here to ensure a non-200 response if critical data is missing
  }

  let newOrderStatus = null;
  let newPaymentStatus = null;
  let finalAmountForOrder = 0;
  let updateNotes = '';

  switch (paymentStatus) {
    case 'PAID':
      newOrderStatus = 'Order Placed';
      newPaymentStatus = 'Completed';
      finalAmountForOrder = amountPaid * 100; // Convert to Naira if needed, assuming amountPaid is in Kobo
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
      throw new HttpError(400, `Unhandled Monnify payment status: ${paymentStatus}.`); // Throwing if status is not explicitly handled
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

/**
 * Main entry point for handling the webhook from the controller.
 * @param {object} params - The webhook parameters.
 * @param {string} params.signature - The 'monnify-signature' from the request header.
 * @param {string} params.rawBodyString - The raw request body as a string.
 * @throws {HttpError} If signature is invalid, payload is malformed, or processing fails.
 */
const processMonnifyWebhook = async ({ signature, rawBodyString }) => {
  logger.info('[Payment Service] Starting Monnify webhook processing pipeline.');
  logger.debug('[Payment Service] Received params for processMonnifyWebhook:', { signature, rawBodyString: rawBodyString.substring(0, 100) + '...' }); // Log a snippet of rawBody

  // 1. Verify the signature for security
  verifyMonnifySignature({ signature, rawBodyString }); // Throws on invalid
  logger.info('[Payment Service] Webhook signature verified successfully. Proceeding to parse payload.');

  // 2. Parse the body and process the event
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

  await processWebhookEvent(eventData, eventType); // Delegate to event processing
  logger.info('[Payment Service] Monnify webhook processing pipeline completed.');
};

module.exports = {
  processMonnifyWebhook,
  verifyMonnifySignature, // Exported for use in controller
};