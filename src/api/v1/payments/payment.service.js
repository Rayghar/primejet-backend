// File: src/api/v1/payments/payment.service.js

const Order = require('../../../models/order.model');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');

/**
 * Processes an incoming webhook from Flutterwave.
 * This is now the single source of truth for confirming a payment.
 * @param {object} { signature, body }
 * @returns {Promise<void>}
 */
const processFlutterwaveWebhook = async ({ signature, body }) => {
  // Step 1: Verify the webhook's integrity using the secret hash.
  const secretHash = process.env.FLUTTERWAVE_SECRET_HASH;
  if (!signature || signature !== secretHash) {
    logger.warn('Webhook received with invalid signature.');
    throw new HttpError(401, 'Invalid signature.');
  }

  // Step 2: Check the event type and data structure to ensure it's a successful charge.
  // Add checks for body.data and body.data.status existence BEFORE accessing them.
  if (body.event !== 'charge.completed' || !body.data || body.data.status !== 'successful') { // <<< MODIFIED LINE
    // Safely log the status if body.data and body.data.status exist, otherwise just the event.
    const statusToLog = body.data && body.data.status ? ` with status ${body.data.status}` : '';
    logger.info(`Ignoring non-successful or malformed webhook event: ${body.event}${statusToLog}`); // <<< MODIFIED LINE
    return; // Acknowledge and ignore other events (like 'charge.started', 'charge.failed' or malformed ones)
  }

  const { tx_ref, id, amount, currency } = body.data; // Now confident body.data exists

  // Step 3: Find the corresponding order in your database using the transaction reference (tx_ref).
  const order = await Order.findOne({ id: tx_ref });

  if (!order) {
    // This can happen if the webhook arrives before the database has committed the order.
    logger.error(`Webhook Error: Order with tx_ref ${tx_ref} not found.`);
    throw new HttpError(404, 'Order not found for webhook processing.');
  }

  // Step 4: Idempotency Check. Prevents processing the same event twice.
  if (order.paymentStatus === 'Completed') {
    logger.info(`Webhook: Order ${tx_ref} is already marked as completed. Ignoring duplicate event.`);
    return;
  }

  // Step 5: Perform final security checks on amount and currency.
  // IMPORTANT: Re-confirm the unit of 'amount' from Flutterwave webhooks.
  // Most gateways send amounts in MINOR units (e.g., Kobo/cents).
  // If Flutterwave sends 'amount' in minor units, the line below needs to be:
  // const amountPaidInMajorUnit = amount / 100;
  const amountPaidInMajorUnit = amount; // <<< RE-CHECK THIS LINE (based on your Flutterwave webhook docs)

  // Assuming order.grandTotal is stored in MINOR units (e.g., Kobo) in your database
  if ((order.grandTotal / 100) !== amountPaidInMajorUnit) { // Compare minor units after converting both
    logger.warn(`SECURITY ALERT: Webhook amount mismatch for order ${order.id}. Order (major): ${order.grandTotal / 100}, Paid (major): ${amountPaidInMajorUnit}.`);
    throw new HttpError(400, 'Payment amount mismatch.');
  }
  // If order.grandTotal is stored in MAJOR units in your database, then you'd compare directly:
  // if (order.grandTotal !== amountPaidInMajorUnit) { ... }

  if ((order.currency || 'NGN').toUpperCase() !== currency.toUpperCase()) {
      logger.warn(`SECURITY ALERT: Webhook currency mismatch for order ${order.id}. Order: ${order.currency}, Paid: ${currency}.`);
      throw new HttpError(400, 'Payment currency mismatch.');
  }

  // Step 6: All checks passed. Update the order in the database.
  order.paymentStatus = 'Completed';
  // If order.grandTotal is in minor units, and amountPaidInMajorUnit is major,
  // then finalAmountPaid should be order.grandTotal (minor units) or amountPaidInMajorUnit * 100 (minor units)
  order.finalAmountPaid = order.grandTotal; // Assuming order.grandTotal is correct minor unit amount
  order.paymentTransactionId = id.toString();
  order.status = 'Order Placed';
  order.statusHistory.push({ status: 'Payment Completed', timestamp: new Date(), notes: `Verified by Flutterwave Webhook. Transaction ID: ${id}` });

  await order.save();
  logger.info(`Webhook: Successfully processed and updated order ${tx_ref}.`);
};

module.exports = {
  processFlutterwaveWebhook,
};