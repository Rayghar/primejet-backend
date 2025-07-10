// File: src/api/v1/payments/payment.controller.js
const paymentService = require('./payment.service');
const { logger } = require('../../../config/logger.config'); // Ensure logger is imported

// Middleware to save the raw body for hash verification
const rawBodySaver = (req, res, buf, encoding) => {
  if (buf && buf.length) {
    req.rawBody = buf.toString(encoding || 'utf8');
  }
};

const handleFlutterwaveWebhook = async (req, res, next) => {
  try {
    const signature = req.headers['verif-hash'];
    await paymentService.processFlutterwaveWebhook({ signature, body: req.body });

    res.sendStatus(200);
  } catch (error) {
    next(error);
  }
};

// --- NEW: Controller for Monnify Webhook ---
const handleMonnifyWebhook = async (req, res, next) => {
  try {
    // Monnify sends the signature in the 'monnify-signature' header.
    const signature = req.headers['monnify-signature']; // [cite: 548, 724]
    const rawBody = req.rawBody; // Get the raw body saved by the middleware

    if (!rawBody) {
      logger.error('Monnify Webhook: Raw body not available for signature verification.');
      return res.status(400).json({ status: 'error', message: 'Raw body required for signature verification.' });
    }

    // Process the webhook using the new Monnify-specific service function
    await paymentService.processMonnifyWebhook({ signature, rawBody, body: req.body });

    // Always send a 200 OK to acknowledge receipt to Monnify. [cite: 522, 697, 829]
    res.sendStatus(200);
  } catch (error) {
    // Log the specific error for debugging
    logger.error(`Monnify Webhook Error: ${error.message}`, { errorStack: error.stack, payload: req.body });
    // Let the central error handler manage the response for the internal server error case.
    next(error);
  }
};

module.exports = {
  handleFlutterwaveWebhook,
  handleMonnifyWebhook, // Export the new controller
  rawBodySaver // Export the raw body saver middleware
};