// File: src/api/v1/payments/interswitch.controller.js
const interswitchService = require('./interswitch.service'); // New Interswitch service
const { logger } = require('../../../config/logger.config');

// Middleware to save the raw body (if Interswitch webhooks ever provide signature validation)
const rawBodySaver = (req, res, buf, encoding) => {
  if (buf && buf.length) {
    req.rawBody = buf.toString(encoding || 'utf8');
  }
};

// Controller to verify a transaction with Interswitch (called by Flutter app after client-side payment)
const verifyTransaction = async (req, res, next) => {
  try {
    const { transactionReference, amount, orderId } = req.body; // Expect reference, amount (from client), and orderId

    // Call service to perform server-side verification with Interswitch
    const verificationResult = await interswitchService.verifyTransactionStatus({
      transactionReference,
      amount, // Amount from client (for initial comparison)
      orderId, // Your internal order ID
    });

    res.status(200).json(verificationResult);
  } catch (error) {
    logger.error(`Interswitch Verify Transaction Error: ${error.message}`, { errorStack: error.stack, payload: req.body });
    next(error); // Pass to central error handler
  }
};

// Controller to handle incoming Interswitch webhooks (IPN Service)
const handleInterswitchWebhook = async (req, res, next) => {
  try {
    // Interswitch webhook details are sparse regarding signature validation in current docs.
    // If a signature header (e.g., 'X-Interswitch-Signature') exists, capture it.
    const signature = req.headers['x-interswitch-signature']; // Example header name (verify exact name from docs)
    const rawBody = req.rawBody; // Captured by rawBodySaver if JSON body parsing is conditional

    // Log the incoming webhook for debugging, as validation details are uncertain
    logger.info('Interswitch Webhook received.', {
      payload: req.body,
      headers: req.headers,
      signature: signature
    });

    // We don't trust webhooks alone due to lack of strong signature validation details.
    // Instead, we use it as a trigger to re-query Interswitch API.
    // Extract necessary data to trigger verification.
    // The exact fields depend on the webhook payload. Assuming 'reference' and 'amount'.
    const { reference, amount } = req.body; // Adjust based on actual Interswitch webhook payload
    const orderId = req.body.orderId || req.body.metadata?.orderId; // Try to get orderId if passed in payload

    if (reference && amount) {
        // Trigger a background verification to avoid blocking webhook response
        interswitchService.verifyTransactionStatus({
            transactionReference: reference,
            amount: amount,
            orderId: orderId, // Pass your order ID if available in webhook
        }).catch(err => {
            logger.error(`Interswitch Webhook: Background verification failed for ref ${reference}: ${err.message}`, { error: err });
        });
    } else {
        logger.warn('Interswitch Webhook: Received payload missing key info for background verification.', { payload: req.body });
    }

    // Always send a 200 OK to acknowledge receipt to Interswitch immediately.
    res.sendStatus(200);
  } catch (error) {
    logger.error(`Interswitch Webhook Error: ${error.message}`, { errorStack: error.stack, payload: req.body });
    // Still send 200 OK to Interswitch to prevent retries for internal errors
    res.sendStatus(200);
  }
};

module.exports = {
  verifyTransaction,
  handleInterswitchWebhook,
  rawBodySaver, // Export the raw body saver middleware for conditional use
};