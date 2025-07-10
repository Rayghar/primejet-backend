// File: src/api/v1/payments/payment.service.js

const crypto = require('crypto'); // Already used for Flutterwave, but also needed for Monnify
const axios = require('axios'); // For transaction verification if needed
const Order = require('../../../models/order.model');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');

// Ensure these are correctly set in your .env
const FLUTTERWAVE_SECRET_HASH = process.env.FLUTTERWAVE_SECRET_HASH;
const FLUTTERWAVE_SECRET_KEY = process.env.FLUTTERWAVE_SECRET_KEY;
const MONNIFY_CLIENT_SECRET = process.env.MONNIFY_CLIENT_SECRET; // You MUST add this to your .env

/**
 * Processes an incoming webhook from Flutterwave.
 * (Existing function, ensure updated as per previous discussions)
 */
const processFlutterwaveWebhook = async ({ signature, body }) => {
  if (body.data === undefined || body.data.status === undefined) {
    const statusToLog = body.data && body.data.status ? ` with status ${body.data.status}` : '';
    logger.info(`Ignoring non-successful or malformed webhook event: ${body.event}${statusToLog}`);
    return;
  }
  // Step 1: Verify the webhook's integrity using the secret hash.
  const secretHash = process.env.FLUTTERWAVE_SECRET_HASH;
  if (!signature || signature !== secretHash) {
    logger.warn('Flutterwave Webhook received with invalid signature.');
    throw new HttpError(401, 'Invalid signature.');
  }

  // Step 2: Check the event type to ensure it's a successful charge.
  if (body.event !== 'charge.completed' || body.data.status !== 'successful') {
    const statusToLog = body.data && body.data.status ? ` with status ${body.data.status}` : '';
    logger.info(`Ignoring non-successful or malformed Flutterwave webhook event: ${body.event}${statusToLog}`);
    return;
  }

  const { tx_ref, id, amount, currency } = body.data;

  // Step 3: Find the corresponding order in your database using the transaction reference (tx_ref).
  const order = await Order.findOne({ id: tx_ref });

  if (!order) {
    logger.error(`Flutterwave Webhook Error: Order with tx_ref ${tx_ref} not found.`);
    throw new HttpError(404, 'Order not found for webhook processing.');
  }

  // Step 4: Idempotency Check.
  if (order.paymentStatus === 'Completed') {
    logger.info(`Flutterwave Webhook: Order ${tx_ref} is already marked as completed. Ignoring duplicate event.`);
    return;
  }

  // Step 5: Perform final security checks on amount and currency.
  // Assumed: Flutterwave's webhook 'amount' is in MINOR units (e.g., Kobo)
  const amountPaidInMajorUnit = amount / 100;
  // Assuming order.grandTotal is stored in MINOR units (e.g., Kobo)
  if (order.grandTotal !== (amountPaidInMajorUnit * 100)) {
    logger.warn(`SECURITY ALERT: Flutterwave Webhook amount mismatch for order ${order.id}. Order (minor): ${order.grandTotal}, Paid (converted minor): ${amountPaidInMajorUnit * 100}.`);
    throw new HttpError(400, 'Payment amount mismatch.');
  }

  if ((order.currency || 'NGN').toUpperCase() !== currency.toUpperCase()) {
      logger.warn(`SECURITY ALERT: Flutterwave Webhook currency mismatch for order ${order.id}. Order: ${order.currency}, Paid: ${currency}.`);
      throw new HttpError(400, 'Payment currency mismatch.');
  }

  // Step 6: All checks passed. Update the order in the database.
  order.paymentStatus = 'Completed';
  order.finalAmountPaid = order.grandTotal;
  order.paymentTransactionId = id.toString();
  order.status = 'Order Placed';
  order.statusHistory.push({ status: 'Payment Completed', timestamp: new Date(), notes: `Verified by Flutterwave Webhook. Transaction ID: ${id}` });

  await order.save();
  logger.info(`Flutterwave Webhook: Successfully processed and updated order ${tx_ref}.`);
};

// --- NEW: Function to process Monnify Webhooks ---
/**
 * Processes an incoming webhook from Monnify.
 * This is the single source of truth for confirming a Monnify payment.
 * @param {object} { signature, rawBody, body }
 * @returns {Promise<void>}
 */
const processMonnifyWebhook = async ({ signature, rawBody, body }) => {
  // Step 1: Verify the webhook's integrity using the secret hash (Monnify-Signature).
  // Formula: SHA-512(client secret key + object of request body) [cite: 551, 727]
  if (!MONNIFY_CLIENT_SECRET) {
    logger.error('Monnify Client Secret not set in environment variables. Cannot verify webhook signature.');
    throw new HttpError(500, 'Monnify client secret not configured.');
  }

  const computedHash = crypto.createHmac('sha512', MONNIFY_CLIENT_SECRET)
                             .update(rawBody) // [cite: 550, 726] use the raw body for hash computation
                             .digest('hex');

  if (!signature || computedHash !== signature) {
    logger.warn('Monnify Webhook received with invalid signature. Computed:', computedHash, 'Received:', signature);
    throw new HttpError(401, 'Invalid Monnify signature.'); // [cite: 549, 725]
  }

  // Step 2: Check the event type to ensure it's a successful transaction.
  // Monnify uses 'eventType' and 'eventData'. [cite: 526, 541, 702, 717]
  if (body.eventType !== 'SUCCESSFUL_TRANSACTION' || !body.eventData) { // [cite: 528, 586, 704, 762]
    logger.info(`Ignoring non-successful or malformed Monnify webhook event: ${body.eventType}`);
    return; // Acknowledge and ignore other events or malformed payloads
  }

  const eventData = body.eventData; // [cite: 542, 718]
  const { transactionReference, amountPaid, currency, paymentStatus } = eventData; // [cite: 562, 569, 577, 579, 738, 745, 754]

  if (paymentStatus !== 'PAID' && paymentStatus !== 'OVERPAID') { // [cite: 579, 649, 756]
      logger.info(`Monnify Webhook: Ignoring event for transaction ${transactionReference} with status ${paymentStatus}.`);
      return; // Only process 'PAID' or 'OVERPAID' statuses for completion
  }

  // Step 3: Find the corresponding order in your database using the transaction reference.
  // Assuming your order 'id' field matches Monnify's 'transactionReference'
  const order = await Order.findOne({ id: transactionReference });

  if (!order) {
    logger.error(`Monnify Webhook Error: Order with transactionReference ${transactionReference} not found.`);
    throw new HttpError(404, 'Order not found for Monnify webhook processing.'); // [cite: 522, 697]
  }

  // Step 4: Idempotency Check. Prevents processing the same event twice. [cite: 522, 650, 697, 825]
  if (order.paymentStatus === 'Completed') {
    logger.info(`Monnify Webhook: Order ${transactionReference} is already marked as completed. Ignoring duplicate event.`);
    return;
  }

  // Step 5: Perform final security checks on amount and currency.
  // Monnify documentation example shows 'amountPaid': 78000 for NGN, implying MINOR units (Kobo)
  // [cite: 569, 745]
  const amountPaidInMajorUnitFromMonnify = amountPaid / 100;

  // Assuming order.grandTotal is stored in MINOR units (e.g., Kobo) in your database
  if (order.grandTotal !== amountPaid) { // Compare minor units directly
    logger.warn(`SECURITY ALERT: Monnify Webhook amount mismatch for order ${order.id}. Order (minor): ${order.grandTotal}, Paid (minor): ${amountPaid}.`);
    throw new HttpError(400, 'Payment amount mismatch.');
  }

  if ((order.currency || 'NGN').toUpperCase() !== currency.toUpperCase()) {
      logger.warn(`SECURITY ALERT: Monnify Webhook currency mismatch for order ${order.id}. Order: ${order.currency}, Paid: ${currency}.`);
      throw new HttpError(400, 'Payment currency mismatch.');
  }

  // Step 6: All checks passed. Update the order in the database.
  order.paymentStatus = 'Completed';
  order.finalAmountPaid = amountPaid; // Use the exact amount from Monnify webhook
  order.paymentTransactionId = eventData.paymentReference; // Monnify's paymentReference is unique for the transaction
  order.status = 'Order Placed'; // Move from 'Pending Payment' to the next active state.
  order.statusHistory.push({ status: 'Payment Completed', timestamp: new Date(), notes: `Verified by Monnify Webhook. Transaction Ref: ${transactionReference}` });

  await order.save();
  logger.info(`Monnify Webhook: Successfully processed and updated order ${transactionReference}.`);
};

module.exports = {
  processFlutterwaveWebhook,
  processMonnifyWebhook, // Export the new service function
};