// File: src/api/v1/payments/opay.controller.js
const opayService = require('./o./opay.service New OPay service
const { logger } = require('../../../config/logger.config');

// Middleware to save the raw body for hash verification (crucial for OPay signature)
const rawBodySaver = (req, res, buf, encoding) => {
  if (buf && buf.length) {
    req.rawBody = buf.toString(encoding || 'utf8');
  }
};

// Controller to handle incoming OPay webhooks
const handleOpayWebhook = async (req, res, next) => {
  try {
    // Extract headers needed for OPay signature verification
    const signature = req.headers['signature']; // OPay uses 'signature' header
    const xOpayTranid = req.headers['x-opay-tranid'];
    const merchantId = req.headers['merchantid'];
    const clientAuthKey = req.headers['clientauthkey'];
    const version = req.headers['version']; // e.g., V1.0.1
    const bodyFormat = req.headers['bodyformat']; // e.g., JSON
    const timestamp = req.headers['timestamp']; // Milliseconds since epoch

    const rawBody = req.rawBody; // The raw body is essential for signature verification

    if (!rawBody) {
      logger.error('OPay Webhook: Raw body not available for signature verification.', { payload: req.body });
      return res.status(400).json({ status: 'error', message: 'Raw body required for signature verification.' });
    }

    // Pass all necessary info to the service for validation and processing
    await opayService.processOpayWebhook({
      signature,
      xOpayTranid,
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
    res.status(200).json({ code: '00000', message: 'SUCCESSFUL' }); //
  } catch (error) {
    logger.error(`OPay Webhook Error: ${error.message}`, { errorStack: error.stack, payload: req.body, headers: req.headers });
    // For webhook errors, still return 200 OK after logging to prevent retries if the error is internal.
    // However, if it's a validation error (401, 400), you might return that status.
    // For now, consistent 200 for internal errors as per doc advice to prevent retries.
    // Or return 4xx for invalid requests. Let's stick to 200 for now.
    res.status(error.statusCode || 500).json({ code: 'XXXXX', message: error.message }); // OPay wants 'code' in response
  }
};

// You might add controller for querying order status from OPay if implemented
// const getOpayOrderStatus = async (req, res, next) => { ... };

module.exports = {
  handleOpayWebhook,
  rawBodySaver,
  // getOpayOrderStatus,
};