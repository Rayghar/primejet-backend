// File: src/api/v1/payments/payment.service.js
const crypto = require('crypto');
const Order = require('../../../models/order.model');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');

const processMonnifyWebhook = async ({ signature, rawBody }) => {
  // Step 1: Verify the webhook's integrity using the Client Secret Key.
  const clientSecret = process.env.MONNIFY_SECRET_KEY;
  if (!clientSecret) {
    throw new HttpError(500, 'Monnify client secret is not configured.');
  }

  const computedHash = crypto.createHmac('sha512', clientSecret).update(rawBody).digest('hex');

  if (computedHash !== signature) {
    logger.warn('Webhook received with an invalid monnify-signature.');
    throw new HttpError(401, 'Invalid signature.');
  }

  const body = JSON.parse(rawBody);
  
  // Step 2: Check for the successful transaction event.
  if (body.eventType !== 'SUCCESSFUL_TRANSACTION') {
    logger.info(`Ignoring Monnify webhook event: ${body.eventType}`);
    return;
  }
  
  const { paymentReference, transactionReference, amountPaid, paymentStatus } = body.eventData;

  if (paymentStatus !== 'PAID') {
    logger.info(`Ignoring transaction with non-PAID status: ${paymentStatus}`);
    return;
  }

  // Step 3: Find the order using the paymentReference (which is our order ID).
  const order = await Order.findOne({ id: paymentReference });
  if (!order) {
    logger.error(`Webhook Error: Order with paymentReference ${paymentReference} not found.`);
    throw new HttpError(404, 'Order not found for webhook processing.');
  }

  // Step 4: Prevent processing the same event twice.
  if (order.paymentStatus === 'Completed') {
    logger.info(`Webhook: Order ${paymentReference} is already marked as completed.`);
    return;
  }

  // Step 5: Verify the amount paid.
  const amountPaidMajorUnit = amountPaid;
  if ((order.grandTotal / 100) !== amountPaidMajorUnit) {
    throw new HttpError(400, 'Payment amount mismatch.');
  }

  // Step 6: Update the order in the database.
  order.paymentStatus = 'Completed';
  order.finalAmountPaid = order.grandTotal;
  order.paymentTransactionId = transactionReference;
  order.status = 'Order Placed';
  order.statusHistory.push({ status: 'Payment Completed', timestamp: new Date(), notes: `Verified by Monnify Webhook. Ref: ${transactionReference}` });
  
  await order.save();
  logger.info(`Webhook: Successfully processed and updated order ${paymentReference}.`);
};

module.exports = {
  processMonnifyWebhook,
};