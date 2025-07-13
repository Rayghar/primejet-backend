// File: src/api/v1/payments/opay.controller.js
const opayService = require('./opay.service'); // Corrected import path
const { logger } = require('../../../config/logger.config');
const HttpError = require('../../../utils/HttpError'); // Import HttpError

// Middleware to save the raw body for hash verification (crucial for OPay signature)
const rawBodySaver = (req, res, buf, encoding) => {
  if (buf && buf.length) {
    req.rawBody = buf.toString(encoding || 'utf8');
  }
};

// Controller to initialize OPay payment from the frontend
const initializeOpayPaymentForOrder = async (req, res, next) => {
  try {
    const { orderId } = req.body;
    const userId = req.user.id; // Assuming user ID is available from auth middleware

    // You might need to fetch more details from the order or user here
    // For simplicity, let's assume orderId is enough for the service to find details
    const order = await opayService.initializeOpayPayment({
      orderId,
      userId,
      // Pass other necessary details from req.body or fetched from DB
      customerEmail: req.user.email, // Example
      customerName: req.user.name,   // Example
      customerPhone: req.user.phone, // Example
      productName: "Gas Cylinder Order", // Example, fetch from order items if detailed
      productDescription: `Order ${orderId}`, // Example
      callbackUrl: `${process.env.BACKEND_URL}/opay/callback`, // Your public callback URL
      userClientIP: req.ip, // User's IP address
    });

    res.status(200).json(order);
  } catch (error) {
    logger.error(`[OPAY_CONTROLLER] Error initializing OPay payment: ${error.message}`, { errorStack: error.stack, payload: req.body });
    next(error);
  }
};

// Controller to handle incoming OPay webhooks
const handleOpayWebhook = async (req, res, next) => {
  try {
    // Extract headers needed for OPay signature verification
    // OPay webhook headers can vary, verify with their documentation.
    // Common headers: 'signature', 'x-opay-tranid', 'merchantid', 'clientauthkey', 'version', 'bodyformat', 'timestamp'
    const signature = req.headers['signature'] || req.headers['x-opay-signature']; // Common OPay signature headers
    const merchantId = req.headers['merchantid'];
    const clientAuthKey = req.headers['clientauthkey'];
    const version = req.headers['version'];
    const bodyFormat = req.headers['bodyformat'];
    const timestamp = req.headers['timestamp'];

    const rawBody = req.rawBody; // The raw body is essential for signature verification

    if (!rawBody) {
      logger.error('OPay Webhook: Raw body not available for signature verification.', { payload: req.body });
      return res.status(400).json({ code: '40000', message: 'Raw body required for signature verification.' });
    }

    // Pass all necessary info to the service for validation and processing
    await opayService.processOpayWebhook({
      signature,
      merchantId,
      clientAuthKey,
      version,
      bodyFormat,
      timestamp,
      rawBody,
      body: req.body // The parsed JSON body
    });

    // Always send a 200 OK to acknowledge receipt to OPay immediately (within 5 seconds)
    // OPay expects a specific JSON response for successful acknowledgement.
    res.status(200).json({ code: '00000', message: 'SUCCESSFUL' });
  } catch (error) {
    logger.error(`OPay Webhook Error: ${error.message}`, { errorStack: error.stack, payload: req.body, headers: req.headers });
    // For webhook errors, still return 200 OK after logging to prevent retries if the error is internal.
    // OPay wants 'code' in response even for errors.
    res.status(error.statusCode || 500).json({ code: 'XXXXX', message: error.message });
  }
};

// Controller for manual OPay transaction verification (optional)
const verifyOpayTransaction = async (req, res, next) => {
  try {
    const { orderNo, reference } = req.body; // Expect OPay orderNo or your reference
    const result = await opayService.verifyOpayTransaction({ orderNo, reference });
    res.status(200).json(result);
  } catch (error) {
    logger.error(`[OPAY_CONTROLLER] Error verifying OPay transaction: ${error.message}`, { errorStack: error.stack, payload: req.body });
    next(error);
  }
};

module.exports = {
  initializeOpayPaymentForOrder,
  handleOpayWebhook,
  rawBodySaver,
  verifyOpayTransaction,
};