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
  // This ensures the request is genuinely from Flutterwave.
  const secretHash = process.env.FLUTTERWAVE_SECRET_HASH;
  if (!signature || signature !== secretHash) {
    logger.warn('Webhook received with invalid signature.');
    throw new HttpError(401, 'Invalid signature.'); // Discard unauthorized requests
  }

  // Step 2: Check the event type to ensure it's a successful charge.
  // We only care about successfully completed charges.
  if (body.event !== 'charge.completed' || body.data.status !== 'successful') {
    logger.info(`Ignoring non-successful webhook event: ${body.event} with status ${body.data.status}`);
    return; // Acknowledge and ignore other events (like 'charge.started')
  }

  const { tx_ref, id, amount, currency } = body.data;

  // Step 3: Find the corresponding order in your database using the transaction reference (tx_ref).
  const order = await Order.findOne({ id: tx_ref });

  if (!order) {
    // This can happen if the webhook arrives before the database has committed the order.
    // Throwing an error will cause Flutterwave to retry, giving the DB time to catch up.
    logger.error(`Webhook Error: Order with tx_ref ${tx_ref} not found.`);
    throw new HttpError(404, 'Order not found for webhook processing.');
  }

  // Step 4: Idempotency Check. Prevents processing the same event twice.
  // If the order is already marked 'Completed', we've already handled this event.
  if (order.paymentStatus === 'Completed') {
    logger.info(`Webhook: Order ${tx_ref} is already marked as completed. Ignoring duplicate event.`);
    return;
  }

  // Step 5: Perform final security checks on amount and currency.
  const amountPaidInMajorUnit = amount;
  if ((order.grandTotal / 100) !== amountPaidMajorUnit) {
    logger.warn(`SECURITY ALERT: Webhook amount mismatch for order ${order.id}. Order: ${order.grandTotal / 100}, Paid: ${amountPaidMajorUnit}.`);
    throw new HttpError(400, 'Payment amount mismatch.');
  }
  if ((order.currency || 'NGN').toUpperCase() !== currency.toUpperCase()) {
      logger.warn(`SECURITY ALERT: Webhook currency mismatch for order ${order.id}. Order: ${order.currency}, Paid: ${currency}.`);
      throw new HttpError(400, 'Payment currency mismatch.');
  }

  // Step 6: All checks passed. Update the order in the database.
  order.paymentStatus = 'Completed';
  order.finalAmountPaid = order.grandTotal;
  order.paymentTransactionId = id.toString();
  order.status = 'Order Placed'; // Move from 'Pending Payment' to the next active state.
  order.statusHistory.push({ status: 'Payment Completed', timestamp: new Date(), notes: `Verified by Flutterwave Webhook. Transaction ID: ${id}` });
  
  await order.save();
  logger.info(`Webhook: Successfully processed and updated order ${tx_ref}.`);
};

module.exports = {
  processFlutterwaveWebhook,
};