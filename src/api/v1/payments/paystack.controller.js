// File: src/api/v1/payments/paystack.controller.js
const paystackService = require('./paystack.service');
const { logger } = require('../../../config/logger.config'); // Assuming you have a logger

// Middleware to save the raw body for hash verification (needed by Paystack)
const rawBodySaver = (req, res, buf, encoding) => {
  if (buf && buf.length) {
    req.rawBody = buf.toString(encoding || 'utf8');
  }
};

// Controller to initiate a transaction with Paystack (called by Flutter app)
const initializeTransaction = async (req, res, next) => {
  try {
    const { orderId } = req.body;
    const paystackInitData = await paystackService.initiatePaystackTransaction(orderId);
    res.status(200).json(paystackInitData);
  } catch (error) {
    logger.error(`Paystack Init Error: ${error.message}`, { errorStack: error.stack, payload: req.body });
    next(error); // Pass to central error handler
  }
};

// Controller to handle incoming Paystack webhooks
const handlePaystackWebhook = async (req, res, next) => {
  try {
    const signature = req.headers['x-paystack-signature'];
    const rawBody = req.rawBody; // The raw body is essential for signature verification

    if (!rawBody) {
      logger.error('Paystack Webhook: Raw body not available for signature verification.');
      return res.status(400).json({ status: 'error', message: 'Raw body required for signature verification.' });
    }

    await paystackService.processPaystackWebhook({ signature, rawBody, body: req.body });

    // Always send a 200 OK to acknowledge receipt to Paystack immediately.
    res.sendStatus(200);
  } catch (error) {
    logger.error(`Paystack Webhook Error: ${error.message}`, { errorStack: error.stack, payload: req.body });
    next(error); // Pass to central error handler
  }
};

module.exports = {
  initializeTransaction,
  handlePaystackWebhook,
  rawBodySaver,
};