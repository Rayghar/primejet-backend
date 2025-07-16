// File: src/api/v1/payments/payment.service.js
const crypto = require('crypto');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');
const orderService = require('../orders/order.service'); // Import the order service
const dotenv = require('dotenv');

dotenv.config();

const MONNIFY_SECRET_KEY ="2Z659QCSA4GCPR0VKTPQTB81A3R7XHK4";

/**
 * Verifies the integrity of the Monnify webhook notification.
 * @param {string} signature - The value of the 'monnify-signature' header.
 * @param {Buffer} rawBody - The raw request body from Express.
 * @returns {boolean} - True if the signature is valid, false otherwise.
 */
const verifySignature = (signature, rawBody) => {
  if (!signature || !rawBody || !MONNIFY_SECRET_KEY) {
    logger.error('[Payment Service] Missing signature, request body, or secret key for verification.');
    return false;
  }
  // The hash is calculated using your secret key and the raw request body [cite: 68]
  const hash = crypto
    .createHmac('sha512', MONNIFY_SECRET_KEY)
    .update(rawBody)
    .digest('hex');
  
  const isSignatureValid = hash === signature;
  if (!isSignatureValid) {
    logger.warn(`[Payment Service] Invalid webhook signature. Computed: ${hash}, Received: ${signature}`);
  }
  return isSignatureValid;
};

/**
 * Processes the validated webhook event from Monnify.
 * @param {object} eventData - The 'eventData' object from the Monnify payload.
 */
const processWebhookEvent = async (eventData) => {
  const { paymentReference, paymentStatus, transactionReference, amountPaid, paymentMethod } = eventData;

  // The 'paymentReference' from the SDK is your internal orderId
  const orderId = paymentReference; 

  if (!orderId) {
    logger.warn('[Payment Service] Webhook received without a paymentReference (orderId). Skipping.');
    throw new HttpError('Webhook payload missing paymentReference.', 400);
  }

  // Check if the transaction was successful [cite: 45]
  if (paymentStatus === 'PAID') {
    logger.info(`[Payment Service] Processing successful payment for order: ${orderId}`);
    
    const paymentDetails = {
      method: paymentMethod || 'Monnify', // e.g., 'CARD', 'ACCOUNT_TRANSFER'
      transactionId: transactionReference,
      amount: amountPaid, // Amount is already in the smallest unit (kobo) from Monnify
      paidAt: new Date(),
      monnifyStatus: paymentStatus,
    };

    // Call your existing order service to securely update the order
    // This will change status to 'Order Placed', set payment to 'Completed', etc.
    await orderService.updateOrderStatus({
      orderId: orderId,
      status: 'paid', // A trigger word for the service to know it's a successful payment
      paymentDetails: paymentDetails,
      verifiedAmount: amountPaid,
    });

  } else {
    // Handle other statuses like 'FAILED', 'PENDING', etc.
    logger.warn(`[Payment Service] Received non-successful payment status '${paymentStatus}' for order: ${orderId}`);
  }
};

/**
 * Main entry point for handling the webhook from the controller.
 * @param {object} params - The webhook parameters.
 * @param {string} params.signature - The 'monnify-signature' from the request header.
 * @param {Buffer} params.rawBody - The raw request body.
 */
const processMonnifyWebhook = async ({ signature, rawBody }) => {
  // 1. Verify the signature for security [cite: 66, 389]
  const isVerified = verifySignature(signature, rawBody);
  if (!isVerified) {
    throw new HttpError('Invalid Monnify signature.', 401);
  }

  // 2. Parse the body and process the event
  const payload = JSON.parse(rawBody.toString());
  const { eventType, eventData } = payload;
  
  logger.info(`[Payment Service] Received Monnify webhook. Event Type: ${eventType}`);

  // We only care about successful transaction events for this flow [cite: 45]
  if (eventType === 'SUCCESSFUL_TRANSACTION') {
    await processWebhookEvent(eventData);
  } else {
    logger.info(`[Payment Service] Skipping event type '${eventType}' as it is not 'SUCCESSFUL_TRANSACTION'.`);
  }
};

module.exports = {
  processMonnifyWebhook,
};