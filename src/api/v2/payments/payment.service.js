// File: src/api/v1/payments/payment.service.js
const crypto = require('crypto');
const axios = require('axios');
const Order = require('../../../models/order.model');
const User = require('../../../models/user.model');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');

/**
 * Creates a Paystack Transaction and returns an access_code.
 */
// UPDATED: The function now accepts a session object
const initializePayment = async ({ orderId, userId, session }) => {
  if (!process.env.PAYSTACK_SECRET_KEY) {
    throw new HttpError(500, 'Paystack payment gateway is not configured.');
  }

  const order = await Order.findOne({ id: orderId, customerId: userId }).session(session);
  if (!order) {
    throw new HttpError(404, 'Order not found or does not belong to user.');
  }
  if (order.paymentStatus === 'Completed') {
    throw new HttpError(400, 'This order has already been paid.');
  }

  // UPDATED: Changed User.findById(userId) to User.findOne({ id: userId })
  const user = await User.findOne({ id: userId }).select('email').session(session);
  if (!user) {
    throw new HttpError(404, 'Customer not found.');
  }

  const amountToCharge = Math.round(order.grandTotal);
  if (amountToCharge <= 0) {
    return { message: "No payment required.", accessCode: null, paymentNeeded: false };
  }
  
  const paystackUrl = 'https://api.paystack.co/transaction/initialize';
  const headers = { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` };
  const body = {
    email: user.email,
    amount: amountToCharge,
    reference: order.id,
    metadata: { order_id: order.id, customer_id: userId }
  };

  try {
    const { data } = await axios.post(paystackUrl, body, { headers });
    if (data && data.status === true) {
      order.paymentTransactionId = data.data.reference;
      order.paymentGateway = 'paystack';
      order.paymentStatus = 'Processing (Gateway)';
      await order.save({ session });
      
      logger.info(`Paystack transaction initialized for order ${orderId}`);
      return { accessCode: data.data.access_code, paymentNeeded: true };
    } else {
      throw new Error(data.message || 'Paystack initialization failed.');
    }
  } catch (error) {
    logger.error(`Error initializing Paystack transaction for order ${orderId}:`, error.response ? error.response.data : error.message);
    throw new HttpError(500, 'Failed to initialize Paystack payment.');
  }
};

const verifyPaystackTransaction = async ({ reference, orderId }) => {
  if (!reference) throw new HttpError(400, 'Payment reference is required.');
  if (!process.env.PAYSTACK_SECRET_KEY) throw new HttpError(500, 'Paystack service is not configured.');

  const verifyUrl = `https://api.paystack.co/transaction/verify/${reference}`;
  const headers = { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` };

  try {
    const { data: response } = await axios.get(verifyUrl, { headers });

    if (response.data.status !== 'success') {
      throw new HttpError(400, `Payment not successful. Status: ${response.data.status}`);
    }

    const order = await Order.findOne({ id: orderId });
    if (!order) {
      throw new HttpError(404, `Order with ID ${orderId} not found for verification.`);
    }

    // Security Check: Verify that the amount paid matches the order total
    if (order.grandTotal !== response.data.amount) {
      logger.warn(`SECURITY ALERT: Amount mismatch for order ${order.id}. Order Total: ${order.grandTotal}, Paystack Paid: ${response.data.amount}.`);
      throw new HttpError(400, 'Payment amount mismatch.');
    }

    // Update order status if verification is successful
    order.paymentStatus = 'Completed';
    order.finalAmountPaid = response.data.amount;
    order.statusHistory.push({ status: 'Payment Completed', timestamp: new Date(), notes: `Verified Paystack ref: ${reference}` });
     if (order.status === 'Pending Payment') {
        order.status = 'Order Placed'; 
        order.statusHistory.push({ status: order.status, timestamp: new Date(), notes: 'Payment verified via Paystack API.' });
    }
    await order.save();

    logger.info(`Successfully verified and updated order ${order.id}`);
    return { message: 'Payment verified successfully.', order };

  } catch (error) {
    logger.error(`Failed to verify Paystack transaction ${reference}:`, error.response ? error.response.data : error.message);
    throw new HttpError(500, 'Failed to verify payment with Paystack.');
  }
};

/**
 * Verifies and processes a Paystack webhook event.
 */
const processPaystackWebhook = async (rawBody, signature) => {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  const hash = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');
  if (hash !== signature) {
    throw new HttpError(400, 'Invalid Paystack signature.');
  }

  const event = JSON.parse(rawBody);
  logger.info(`Received Paystack webhook event: ${event.event}`);

  if (event.event === 'charge.success') {
    const { reference, amount, status } = event.data;
    if (status !== 'success') return;

    const order = await Order.findOne({ id: reference });
    if (!order) {
      logger.error(`Webhook: Order with reference ${reference} not found.`);
      return;
    }
    if (order.paymentStatus === 'Completed') {
      logger.info(`Webhook: Order ${reference} already marked as completed.`);
      return;
    }
    if (order.grandTotal !== amount) {
      logger.warn(`Webhook: Amount mismatch for order ${order.id}. Expected ${order.grandTotal}, Paystack paid ${amount}.`);
    }

    order.paymentStatus = 'Completed';
    order.finalAmountPaid = amount;
    order.statusHistory.push({ status: 'Payment Completed', timestamp: new Date(), notes: `Paystack reference: ${reference}` });
    if (order.status === 'Pending Payment') {
        order.status = 'Order Placed'; 
        order.statusHistory.push({ status: order.status, timestamp: new Date(), notes: 'Payment confirmed via Paystack.' });
    }
    await order.save();
    logger.info(`Webhook: Order ${reference} payment status updated to Completed.`);
  }
};

module.exports = {
  initializePayment,
  processPaystackWebhook,
  verifyPaystackTransaction,
};