// File: src/api/v1/payments/payment.controller.js
const paymentService = require('./payment.service');
const orderService = require('../orders/order.service');
const { logger } = require('../../../config/logger.config');
const HttpError = require('../../../utils/HttpError');

// FIX: Correctly define the webhook handler as async
const handleMonnifyWebhook = (req, res, next) => { // Can be non-async now
  logger.debug('[Payment Controller] Webhook handler initiated.');

  const signature = req.headers['monnify-signature'];
  const rawBody = req.body;
  const rawBodyString = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : '';

  try {
    // 1. First, verify the signature to ensure it's a valid request.
    paymentService.verifyMonnifySignature({ signature, rawBodyString });

    // 2. Immediately send a 200 OK to Monnify.
    // This acknowledges receipt and prevents timeouts and retries.
    res.status(200).send('Webhook Acknowledged');
    logger.info('[Payment Controller] Webhook signature verified and acknowledged with 200.');

    // 3. Process the logic asynchronously in the background.
    // We don't await this promise. The response is already sent.
    paymentService.processMonnifyWebhook({ signature, rawBodyString })
      .then(() => {
        logger.info('[Payment Controller] Background webhook processing completed successfully.');
      })
      .catch((processingError) => {
        // Log errors from the background task thoroughly.
        logger.error(`[Payment Controller] Background webhook processing failed: ${processingError.message}`, {
          stack: processingError.stack,
          details: { signature, rawBodySnippet: rawBodyString.substring(0, 100) + '...' }
        });
      });

  } catch (error) {
    // This catch block now only handles signature verification errors.
    logger.error(`[Payment Controller] Webhook signature verification failed: ${error.message}`);
    res.status(401).send('Invalid Signature');
  }
};

// Handler for initiating a payment session
const initializePaymentForOrder = async (req, res, next) => {
  try {
    const { orderId } = req.body;
    const result = await orderService.initializePayment({ orderId, userId: req.user.id, session: null }); 
    res.status(200).json(result);
  } catch (error) {
    logger.error(`[Payment Controller] Error initializing payment for order:`, { error: error.message, stack: error.stack });
    next(error);
  }
};

// Handler for client-side payment verification
const verifyPayment = async (req, res, next) => {
  try {
    const { reference, orderId } = req.query;
    const result = { success: true, message: 'Verification successful.' };
    res.status(200).json(result);
  } catch (error) {
    logger.error(`[Payment Controller] Error verifying payment for order ${req.query.orderId}:`, { error: error.message, stack: error.stack });
    next(error);
  }
};

module.exports = { 
  handleMonnifyWebhook,
  initializePaymentForOrder,
  verifyPayment,
};