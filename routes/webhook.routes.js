// File: routes/webhook.routes.js
const express = require('express');
const router = express.Router();
const webhookService = require('../services/webhook.service');
const logger = require('../utils/logger');
const crypto = require('crypto'); // Node.js built-in crypto module
const dotenv = require('dotenv');

dotenv.config();

// Monnify Webhook Endpoint
// This endpoint receives notifications from Monnify after a transaction.
// It DOES NOT require authentication middleware.
router.post('/monnify', async (req, res, next) => {
  logger.info('[Webhook] Monnify webhook received.');
  // req.body is a Buffer due to `express.raw()` middleware in app.js
  logger.debug('[Webhook] Monnify webhook raw body (as string):', req.body.toString());

  // --- IMPORTANT: Webhook Signature Verification as per Monnify Documentation ---
  // 1. Get the signature from Monnify's header
  // The documentation specifies 'monnify-signature' or 'x-monnify-signature'.
  const monnifySignature = req.headers['monnify-signature'] || req.headers['x-monnify-signature'];
  const MONNIFY_SECRET_KEY = process.env.MONNIFY_SECRET_KEY; // Your Monnify Secret Key from .env

  if (!monnifySignature) {
    logger.warn('[Webhook] Missing Monnify-Signature header. Rejecting webhook.');
    return res.status(401).json({ message: 'Unauthorized: Missing signature header' });
  }

  if (!MONNIFY_SECRET_KEY) {
      logger.error('[Webhook] MONNIFY_SECRET_KEY is not defined in environment variables. Webhook verification cannot proceed. Rejecting webhook.');
      return res.status(500).json({ message: 'Server configuration error: MONNIFY_SECRET_KEY missing.' });
  }

  // 2. Calculate local signature using raw body and secret key
  // The documentation specifies HMAC SHA512.
  const hash = crypto.createHmac('sha512', MONNIFY_SECRET_KEY)
                     .update(req.body) // Use the raw Buffer from `express.raw()`
                     .digest('hex');

  // 3. Compare the calculated signature with the received signature
  if (hash !== monnifySignature) {
    logger.warn(`[Webhook] Invalid Monnify webhook signature. Received: ${monnifySignature}, Calculated: ${hash}. Rejecting webhook.`);
    return res.status(401).json({ message: 'Unauthorized: Invalid signature' });
  }

  logger.info('[Webhook] Monnify webhook signature verified successfully.');

  // Now that the signature is verified, parse the raw body as JSON
  let monnifyEvent;
  try {
      monnifyEvent = JSON.parse(req.body.toString()); // Convert buffer to string then parse
  } catch (parseError) {
      logger.error('[Webhook] Failed to parse Monnify webhook body as JSON AFTER signature verification:', parseError.message);
      return res.status(400).json({ message: 'Bad Request: Invalid JSON payload after signature check.' });
  }

  const { eventStatus, transactionReference, paymentReference, amountPaid, paidOn, currency } = monnifyEvent;

  // `paymentReference` from Monnify is assumed to be your `orderId`
  const orderId = paymentReference;

  if (!orderId || !transactionReference || !amountPaid) {
    logger.error('[Webhook] Missing required fields in Monnify webhook payload. Payload:', monnifyEvent);
    return res.status(400).json({ message: 'Bad Request: Missing required fields in webhook payload.' });
  }

  try {
    if (eventStatus === 'SUCCESS') {
      logger.info(`[Webhook] Monnify payment SUCCESS event for transaction ${transactionReference}, order ${orderId}`);
      // Delegate to webhook service to handle the payment confirmation and server-to-server verification
      await webhookService.handleMonnifyPaymentWebhook({
        orderId,
        transactionReference,
        amountPaid, // Amount from the webhook (for logging, authoritative source is API call)
        paidOn,
        currency,
        webhookStatus: eventStatus, // Pass the event status from webhook
      });
      // Respond 200 OK to Monnify to acknowledge receipt
      res.status(200).json({ message: 'Webhook processed successfully' });
    } else {
      // Handle non-success statuses (e.g., FAILED, PENDING, EXPIRED)
      logger.warn(`[Webhook] Monnify payment eventStatus: ${eventStatus} for transaction ${transactionReference}, order ${orderId}`);
      // Even for non-success, we call the handler to potentially update order status to 'failed_payment'
      await webhookService.handleMonnifyPaymentWebhook({
          orderId,
          transactionReference,
          amountPaid,
          paidOn,
          currency,
          webhookStatus: eventStatus,
      });
      // Always respond 200 for other statuses to prevent Monnify from retrying excessively.
      res.status(200).json({ message: `Webhook received, status: ${eventStatus}` });
    }
  } catch (error) {
    logger.error('[Webhook] Error processing Monnify webhook:', error.message, error.stack);
    // If an internal error occurs (e.g., DB failure), return 500 so Monnify knows to retry (if configured)
    next(error); // Pass to general error handler
  }
});

module.exports = router;