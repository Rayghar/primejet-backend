// File: src/api/v1/payments/opay.service.js
const crypto = require('crypto');
const axios = require('axios');
const Order = require('../../../models/order.model');
const User = require('../../../models/user.model'); // Assuming User model for email/phone
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');

// OPay API Base URL (from environment variables)
const OPAY_API_BASE_URL = process.env.OPAY_API_BASE_URL || 'https://cashier.opayweb.com'; // Default to production if not set
const OPAY_PUBLIC_KEY = process.env.OPAY_PUBLIC_KEY;
const OPAY_PRIVATE_KEY = process.env.OPAY_PRIVATE_KEY;
const OPAY_MERCHANT_ID = process.env.OPAY_MERCHANT_ID;
const OPAY_APP_ID = process.env.OPAY_APP_ID; // Optional, if OPay provides an App ID
const OPAY_WEBHOOK_SECRET = process.env.OPAY_WEBHOOK_SECRET; // For webhook signature verification

// Helper function to sign OPay requests
// IMPORTANT: OPay's signing algorithm can vary. Refer to your specific OPay API documentation.
// This is a common HMAC-SHA512 signing example. Adjust if OPay uses a different method.
const signOpayRequest = (payload, privateKey) => {
  // OPay often requires `timestamp` to be part of the signed string,
  // or the entire JSON stringified body.
  // For this example, let's assume it's HMAC-SHA512 of the JSON stringified payload.
  // ALWAYS VERIFY OPay's exact signing instructions.
  const payloadString = JSON.stringify(payload);
  return crypto.createHmac('sha512', privateKey).update(payloadString).digest('hex');
};

/**
 * Initiates an OPay transaction by calling the OPay createOrder API.
 * This is called by your frontend.
 */
const initializeOpayPayment = async ({ orderId, userId, amount, customerEmail, customerName, customerPhone, productName, productDescription, callbackUrl, userClientIP, session }) => {
  if (!OPAY_PUBLIC_KEY || !OPAY_PRIVATE_KEY || !OPAY_MERCHANT_ID) {
    throw new HttpError(500, 'OPay payment gateway is not fully configured on the backend.');
  }

  const order = await Order.findOne({ id: orderId, customerId: userId }).session(session);
  if (!order) {
    throw new HttpError(404, 'Order not found or does not belong to user.');
  }
  if (order.paymentStatus === 'Completed') {
    throw new HttpError(400, 'This order has already been paid.');
  }

  const amountToCharge = Math.round(order.grandTotal); // Ensure amount is in smallest currency unit (e.g., Kobo)
  if (amountToCharge <= 0) {
    return { message: "No payment required.", paymentNeeded: false };
  }

  const timestamp = Date.now().toString(); // Milliseconds since epoch

  const opayPayload = {
    publicKey: OPAY_PUBLIC_KEY,
    merchantId: OPAY_MERCHANT_ID,
    merchantName: "Gas2Door", // Your business name as registered with OPay
    reference: order.id, // Your unique order ID
    countryCode: "NG", // Assuming Nigeria, adjust as needed
    payAmount: amountToCharge,
    currency: "NGN", // Assuming NGN, adjust as needed
    productName: productName || 'Gas Cylinder Order',
    productDescription: productDescription || `Order #${order.id.substring(order.id.length - 6)}`,
    callbackUrl: callbackUrl || `${process.env.BACKEND_URL}/api/v1/payment/opay/callback`, // Your backend's public callback URL
    paymentType: "", // Leave empty for all methods, or specify (e.g., "BANK_ACCOUNT")
    expireAt: 30, // Payment expiration in minutes
    userClientIP: userClientIP || '127.0.0.1', // Use actual user IP if available
    userInfo: {
      userId: userId,
      userName: customerName,
      userMobile: customerPhone,
      userEmail: customerEmail,
    },
    // Add other optional fields as per OPay documentation (e.g., `productList`, `terminalId`)
  };

  // OPay requires a signature based on the payload.
  // The exact signing method (which fields, order, hashing algorithm) is CRITICAL.
  // This is an example, VERIFY WITH OPAY'S LATEST DOCS.
  const signature = signOpayRequest(opayPayload, OPAY_PRIVATE_KEY);

  const headers = {
    'Content-Type': 'application/json',
    'MerchantId': OPAY_MERCHANT_ID,
    'ClientAuthKey': OPAY_PUBLIC_KEY, // OPay often uses public key here
    'Signature': signature,
    'Timestamp': timestamp,
    'Version': 'V1.0.1', // Verify OPay's required API version
    'BodyFormat': 'JSON',
    // Add other headers as required by OPay
  };

  try {
    logger.info(`[OPayInit] Calling OPay API to initialize transaction for order ${order.id}.`);
    const { data: opayResponse } = await axios.post(`${OPAY_API_BASE_URL}/api/v1/international/cashier/createOrder`, opayPayload, { headers });

    if (opayResponse && opayResponse.code === '00000') {
      order.paymentTransactionId = opayResponse.data.orderNo; // OPay's order number
      order.paymentGateway = 'opay';
      order.paymentStatus = 'Processing (Gateway)'; // Status while awaiting user payment
      await order.save({ session });

      logger.info(`[OPayInit] OPay transaction initialized successfully for order ${order.id}. OPay OrderNo: ${opayResponse.data.orderNo}`);
      return {
        order: order.toObject(),
        paymentNeeded: true,
        grandTotalToPay: amountToCharge,
        accessCode: opayResponse.data.cashierUrl || opayResponse.data.orderNo, // OPay might return a URL or just the orderNo
        message: 'OPay payment initiated successfully.'
      };
    } else {
      logger.error(`[OPayInit] OPay initialization failed for order ${order.id}: ${opayResponse ? opayResponse.message : 'No response data'}`);
      throw new HttpError(500, opayResponse ? opayResponse.message : 'OPay payment initialization failed.');
    }
  } catch (error) {
    logger.error(`[OPayInit] Error calling OPay API for order ${order.id}:`, {
      message: error.message,
      statusCode: error.response ? error.response.status : null,
      response: error.response ? error.response.data : null,
      headers: headers,
      payload: opayPayload
    });
    throw new HttpError(error.response?.status || 500, error.response?.data?.message || 'Failed to initialize OPay payment.');
  }
};

/**
 * Processes incoming OPay webhook events.
 */
const processOpayWebhook = async ({ signature, merchantId, clientAuthKey, version, bodyFormat, timestamp, rawBody, body }) => {
  if (!OPAY_WEBHOOK_SECRET) {
    logger.error('OPay Webhook: Webhook secret not configured.');
    throw new HttpError(500, 'OPay webhook secret is not configured on the backend.');
  }

  // OPay webhook signature verification (CRITICAL)
  // The exact method to verify the signature (e.g., which headers, which part of the body to sign, algorithm)
  // is specified by OPay. This is a common example.
  // VERIFY OPAY'S WEBHOOK SIGNATURE INSTRUCTIONS CAREFULLY.
  const expectedSignature = crypto.createHmac('sha512', OPAY_WEBHOOK_SECRET).update(rawBody).digest('hex');

  if (expectedSignature !== signature) {
    logger.error('OPay Webhook: Invalid signature.', { receivedSignature: signature, expectedSignature: expectedSignature, rawBody: rawBody });
    throw new HttpError(401, 'Invalid OPay webhook signature.');
  }

  logger.info(`Received OPay webhook event: ${body.status} for order: ${body.outOrderNo}`);

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { status, outOrderNo, orderNo, amount, currency } = body; // OPay's webhook fields

    // Find the order using your internal reference (outOrderNo)
    const order = await Order.findOne({ id: outOrderNo }).session(session);
    if (!order) {
      logger.error(`OPay Webhook: Order with reference ${outOrderNo} not found in DB.`);
      throw new HttpError(404, `Order with reference ${outOrderNo} not found.`);
    }

    // Prevent duplicate processing
    if (order.paymentStatus === 'Completed' && status === 'SUCCESS') {
      logger.info(`OPay Webhook: Order ${outOrderNo} already marked as completed. Skipping.`);
      await session.commitTransaction();
      return { message: 'Order already completed.' };
    }

    // Check amount match (important for security)
    if (order.grandTotal !== amount) { // Assuming 'amount' from webhook is in smallest unit
      logger.warn(`OPay Webhook: Amount mismatch for order ${order.id}. Expected ${order.grandTotal}, OPay paid ${amount}.`);
      // You might want to flag this order for manual review or reverse the transaction
    }

    switch (status) {
      case 'SUCCESS':
        order.paymentStatus = 'Completed';
        order.finalAmountPaid = amount;
        order.paymentGatewayReference = orderNo; // OPay's transaction ID
        order.paymentMethod = 'opay';
        order.statusHistory.push({ status: 'Payment Completed', timestamp: new Date(), notes: `OPay webhook: ${orderNo}` });
        if (order.status === 'Pending Payment') {
          order.status = 'Order Placed';
          order.statusHistory.push({ status: order.status, timestamp: new Date(), notes: 'Payment confirmed via OPay webhook.' });
        }
        break;
      case 'FAIL':
        order.paymentStatus = 'Failed';
        order.statusHistory.push({ status: 'Payment Failed', timestamp: new Date(), notes: `OPay webhook: ${orderNo} - ${body.errorMsg || 'Unknown error'}` });
        break;
      case 'PENDING': // OPay can send pending webhooks
        order.paymentStatus = 'Processing (Gateway)';
        order.statusHistory.push({ status: 'Payment Processing', timestamp: new Date(), notes: `OPay webhook: ${orderNo} - Pending` });
        break;
      // Handle other OPay statuses like 'CLOSE', 'CANCEL' if needed
      default:
        logger.warn(`OPay Webhook: Unhandled status for order ${outOrderNo}: ${status}`);
        order.statusHistory.push({ status: `OPay Status: ${status}`, timestamp: new Date(), notes: `OPay webhook: ${orderNo}` });
        break;
    }

    await order.save({ session });
    await session.commitTransaction();
    logger.info(`OPay Webhook: Order ${outOrderNo} payment status updated to ${status}.`);
    return { message: 'Webhook processed successfully.' };

  } catch (error) {
    await session.abortTransaction();
    logger.error(`OPay Webhook Error processing for order ${body.outOrderNo}: ${error.message}`, { errorStack: error.stack, payload: body });
    if (error instanceof HttpError) throw error;
    throw new HttpError(500, 'Failed to process OPay webhook due to an unexpected error.');
  } finally {
    session.endSession();
  }
};

/**
 * Verifies an OPay transaction status directly from OPay API.
 * This can be used for manual verification or reconciliation.
 */
const verifyOpayTransaction = async ({ orderNo, reference }) => {
  if (!OPAY_PUBLIC_KEY || !OPAY_PRIVATE_KEY || !OPAY_MERCHANT_ID) {
    throw new HttpError(500, 'OPay payment gateway is not fully configured on the backend.');
  }
  if (!orderNo && !reference) {
    throw new HttpError(400, 'Either OPay order number or your internal reference is required for verification.');
  }

  const timestamp = Date.now().toString();
  const verifyPayload = {
    publicKey: OPAY_PUBLIC_KEY,
    merchantId: OPAY_MERCHANT_ID,
    orderNo: orderNo, // OPay's order number
    reference: reference, // Your internal reference
  };

  const signature = signOpayRequest(verifyPayload, OPAY_PRIVATE_KEY); // Use the same signing logic

  const headers = {
    'Content-Type': 'application/json',
    'MerchantId': OPAY_MERCHANT_ID,
    'ClientAuthKey': OPAY_PUBLIC_KEY,
    'Signature': signature,
    'Timestamp': timestamp,
    'Version': 'V1.0.1', // Verify OPay's required API version
    'BodyFormat': 'JSON',
  };

  try {
    logger.info(`[OPayVerify] Calling OPay API to verify transaction for orderNo: ${orderNo || reference}.`);
    const { data: opayResponse } = await axios.post(`${OPAY_API_BASE_URL}/api/v1/international/cashier/queryOrder`, verifyPayload, { headers });

    if (opayResponse && opayResponse.code === '00000' && opayResponse.data) {
      const { status, orderNo: opayOrderNo, reference: opayReference, amount: opayAmount } = opayResponse.data;

      const order = await Order.findOne({ id: opayReference }); // Find by your reference
      if (!order) {
        logger.error(`[OPayVerify] Order with reference ${opayReference} not found for verification.`);
        throw new HttpError(404, `Order with reference ${opayReference} not found.`);
      }

      // Security Check: Verify amount match
      if (order.grandTotal !== opayAmount) { // Assuming opayAmount is in smallest unit
        logger.warn(`[OPayVerify] Amount mismatch for order ${order.id}. Expected ${order.grandTotal}, OPay verified: ${opayAmount}.`);
        // You might want to flag this order for manual review
      }

      if (status === 'SUCCESS') {
        order.paymentStatus = 'Completed';
        order.finalAmountPaid = opayAmount;
        order.paymentGatewayReference = opayOrderNo;
        order.paymentMethod = 'opay';
        order.statusHistory.push({ status: 'Payment Completed', timestamp: new Date(), notes: `OPay API verified: ${opayOrderNo}` });
        if (order.status === 'Pending Payment') {
          order.status = 'Order Placed';
          order.statusHistory.push({ status: order.status, timestamp: new Date(), notes: 'Payment verified via OPay API.' });
        }
      } else if (status === 'FAIL') {
        order.paymentStatus = 'Failed';
        order.statusHistory.push({ status: 'Payment Failed', timestamp: new Date(), notes: `OPay API verified: ${opayOrderNo} - ${opayResponse.message || 'Failed'}` });
      }
      // Handle other statuses like PENDING, CLOSE, CANCEL if needed

      await order.save();
      logger.info(`[OPayVerify] Order ${order.id} payment status updated to ${status} via API verification.`);
      return { message: 'Payment verified successfully.', order: order.toObject(), opayStatus: status };

    } else {
      logger.error(`[OPayVerify] OPay verification failed for orderNo ${orderNo || reference}: ${opayResponse ? opayResponse.message : 'No response data'}`);
      throw new HttpError(500, opayResponse ? opayResponse.message : 'OPay transaction verification failed.');
    }
  } catch (error) {
    logger.error(`[OPayVerify] Error calling OPay API for verification of order ${orderNo || reference}:`, {
      message: error.message,
      statusCode: error.response ? error.response.status : null,
      response: error.response ? error.response.data : null,
      payload: verifyPayload
    });
    throw new HttpError(error.response?.status || 500, error.response?.data?.message || 'Failed to verify OPay payment.');
  }
};

module.exports = {
  initializeOpayPayment,
  processOpayWebhook,
  verifyOpayTransaction,
};