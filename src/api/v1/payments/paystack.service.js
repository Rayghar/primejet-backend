// File: src/api/v1/payments/paystack.service.js
const axios = require('axios');
const crypto = require('crypto');
// const Order = require('../../../models/order.model'); // No longer needed to import Order model here as it's passed directly
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_INIT_URL = 'https://api.paystack.co/transaction/initialize';
const PAYSTACK_VERIFY_URL = 'https://api.paystack.co/transaction/verify';

/**
 * Initiates a transaction with Paystack.
 * This is called by your backend endpoint in response to a Flutter app request.
 * @param {object} order - The Mongoose order document/object directly.
 * @returns {Promise<object>} Paystack initialization response (containing access_code)
 */
const initiatePaystackTransaction = async (order) => { // CHANGED PARAMETER FROM orderId to order
  if (!PAYSTACK_SECRET_KEY) {
    logger.error('Paystack Secret Key not set in environment variables. Cannot proceed with payment initialization.', {
      context: 'PaystackInit',
      orderId: order.id, // Use order.id for logging
      severity: 'CRITICAL_CONFIG'
    });
    throw new HttpError(500, 'Paystack secret key not configured on server.');
  }

  // NO LONGER NEED TO FIND ORDER HERE, IT'S PASSED DIRECTLY FROM ORDER.SERVICE.JS
  // const order = await Order.findOne({ id: orderId });
  // if (!order) {
  //   throw new HttpError(404, 'Order not found for Paystack initialization.');
  // }

  const amountInKobo = order.grandTotal; // order.grandTotal is assumed to be in minor units (e.g., Kobo)

  if (amountInKobo <= 0) {
    logger.warn(`Paystack Init: Invalid amount (${amountInKobo}) for order ${order.id}. Amount must be positive.`, {
      context: 'PaystackInit',
      orderId: order.id,
      amount: amountInKobo,
      severity: 'CLIENT_ERROR'
    });
    throw new HttpError(400, 'Invalid amount for payment initialization.');
  }

  const payload = {
    email: order.customerEmail, // Assuming order model has customer email
    amount: amountInKobo,
    reference: order.id, // Use your order's unique ID as the transaction reference for Paystack
    currency: order.currency || 'NGN', // Ensure currency is set
    metadata: { orderId: order.id, customerId: order.customerId }, // Pass order details in metadata
  };

  try {
    logger.info(`Paystack Init: Calling Paystack API to initialize transaction for order ${order.id}.`, {
      context: 'PaystackInit',
      orderId: order.id,
      payload: payload, // Log the payload sent to Paystack (be careful with sensitive data)
      url: PAYSTACK_INIT_URL
    });

    const response = await axios.post(PAYSTACK_INIT_URL, payload, {
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (response.data && response.data.status) {
      logger.info(`Paystack Init: Transaction initialization successful for order ${order.id}.`, {
        context: 'PaystackInit',
        orderId: order.id,
        paystackResponseStatus: response.data.status,
        paystackResponseData: response.data.data // Log Paystack's response data
      });
      return { accessCode: response.data.data.access_code };
    } else {
      logger.error(`Paystack Init failed for order ${order.id}. Unexpected response from Paystack.`, {
        context: 'PaystackInit',
        orderId: order.id,
        paystackResponse: response.data, // Log the full unexpected response
        statusCode: response.status,
        severity: 'EXTERNAL_API_ERROR'
      });
      throw new HttpError(response.status, response.data.message || 'Paystack initialization failed.');
    }
  } catch (error) {
    // Check if it's an Axios error (network, timeout, 4xx/5xx from Paystack)
    if (error.isAxiosError) {
      logger.error(`Paystack Init: Axios error calling Paystack API for order ${order.id}.`, {
        context: 'PaystackInit',
        orderId: order.id,
        axiosErrorCode: error.code, // e.g., 'ECONNREFUSED', 'ETIMEDOUT'
        responseStatus: error.response?.status,
        responseData: error.response?.data, // Paystack's error response
        requestConfig: error.config, // The request config that caused the error
        stack: error.stack,
        severity: 'EXTERNAL_API_ERROR'
      });
      throw new HttpError(error.response?.status || 500, error.response?.data?.message || 'Failed to connect to Paystack or Paystack returned an error.');
    } else {
      logger.error(`Paystack Init: Unexpected error during transaction initialization for order ${order.id}.`, {
        context: 'PaystackInit',
        orderId: order.id,
        errorName: error.name,
        errorMessage: error.message,
        stack: error.stack,
        severity: 'SERVER_ERROR'
      });
      throw new HttpError(500, 'An unexpected error occurred during payment initialization.');
    }
  }
};

/**
 * Processes an incoming webhook from Paystack.
 */
const processPaystackWebhook = async ({ signature, rawBody, body }) => {
  if (!PAYSTACK_SECRET_KEY) {
    logger.error('Paystack Secret Key not set in environment variables. Cannot verify webhook signature.', {
      context: 'PaystackWebhook',
      severity: 'CRITICAL_CONFIG'
    });
    throw new HttpError(500, 'Paystack secret key not configured.');
  }

  // Step 1: Verify the webhook's integrity
  const hash = crypto.createHmac('sha512', PAYSTACK_SECRET_KEY)
                     .update(rawBody)
                     .digest('hex');

  if (hash !== signature) {
    logger.warn('Paystack Webhook received with invalid signature.', {
      context: 'PaystackWebhook',
      receivedSignature: signature,
      computedHash: hash,
      payload: body, // Log the full payload for invalid signature
      severity: 'SECURITY_ALERT'
    });
    throw new HttpError(401, 'Invalid Paystack signature.');
  }

  // Step 2: Check the event type and status
  if (body.event !== 'charge.success' || !body.data || body.data.status !== 'success') {
    logger.info(`Ignoring non-successful or malformed Paystack webhook event: ${body.event} with status ${body.data?.status || 'N/A'}.`, {
      context: 'PaystackWebhook',
      eventType: body.event,
      eventStatus: body.data?.status,
      transactionReference: body.data?.reference,
      payload: body, // Log full payload for non-success events for debugging
      severity: 'INFO'
    });
    return;
  }

  const eventData = body.data;
  const { reference, amount, currency, status } = eventData;

  // Step 3: Find the corresponding order
  const Order = require('../../../models/order.model'); // Re-import Order model here to use it
  const order = await Order.findOne({ id: reference });
  if (!order) {
    logger.error(`Paystack Webhook Error: Order with reference ${reference} not found.`, {
      context: 'PaystackWebhook',
      transactionReference: reference,
      paystackEventId: eventData.id,
      payload: body, // Log full payload if order not found
      severity: 'APPLICATION_ERROR'
    });
    throw new HttpError(404, 'Order not found for Paystack webhook processing.');
  }

  // Step 4: Idempotency Check
  if (order.paymentStatus === 'Completed') {
    logger.info(`Paystack Webhook: Order ${reference} is already marked as completed. Ignoring duplicate event.`, {
      context: 'PaystackWebhook',
      transactionReference: reference,
      orderId: order.id,
      currentPaymentStatus: order.paymentStatus,
      severity: 'INFO'
    });
    return;
  }

  // Step 5: Perform final security checks on amount and currency.
  if (order.grandTotal !== amount) {
    logger.warn(`SECURITY ALERT: Paystack Webhook amount mismatch for order ${order.id}.`, {
      context: 'PaystackWebhook',
      orderId: order.id,
      expectedAmount: order.grandTotal,
      receivedAmount: amount,
      transactionReference: reference,
      severity: 'SECURITY_ALERT'
    });
    throw new HttpError(400, 'Payment amount mismatch.');
  }

  if ((order.currency || 'NGN').toUpperCase() !== currency.toUpperCase()) {
      logger.warn(`SECURITY ALERT: Paystack Webhook currency mismatch for order ${order.id}.`, {
        context: 'PaystackWebhook',
        orderId: order.id,
        expectedCurrency: order.currency,
        receivedCurrency: currency,
        transactionReference: reference,
        severity: 'SECURITY_ALERT'
      });
      throw new HttpError(400, 'Payment currency mismatch.');
  }

  // Step 6: All checks passed. Update the order.
  order.paymentStatus = 'Completed';
  order.finalAmountPaid = amount;
  order.paymentTransactionId = eventData.id.toString();
  order.status = 'Order Placed';
  order.statusHistory.push({ status: 'Payment Completed', timestamp: new Date(), notes: `Verified by Paystack Webhook. Transaction Ref: ${reference}` });
  order.paymentGateway = 'paystack'; // Ensure payment gateway is recorded
  order.paymentGatewayReference = reference; // Ensure Paystack reference is recorded

  await order.save();
  logger.info(`Paystack Webhook: Successfully processed and updated order ${reference}.`, {
    context: 'PaystackWebhook',
    orderId: order.id,
    transactionReference: reference,
    paystackTransactionId: eventData.id,
    newOrderStatus: order.status,
    newPaymentStatus: order.paymentStatus,
    severity: 'INFO'
  });
};

module.exports = {
  initiatePaystackTransaction,
  processPaystackWebhook,
};