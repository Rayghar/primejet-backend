// File: src/api/v1/payments/payment.controller.js
const paymentService = require('./payment.service');
const orderService = require('../orders/order.service');
const { logger } = require('../../../config/logger.config');
const HttpError = require('../../../utils/HttpError');

// Handler for the Monnify webhook
const handleMonnifyWebhook = async (req, res, next) => {
  logger.debug('[Payment Controller] Webhook handler initiated.');

  const signature = req.headers['monnify-signature'];
  const rawBody = req.body;
  const rawBodyString = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : '';

  logger.debug('[Payment Controller] Webhook received. Signature:', signature);
  logger.debug('[Payment Controller] Raw Body Snippet:', rawBodyString.substring(0, 100) + '...');

  try {
    paymentService.verifyMonnifySignature({ signature, rawBodyString });

    // FIX: Wait for the asynchronous processing to complete before sending the response
    await paymentService.processMonnifyWebhook({ signature, rawBodyString });
    
    res.status(200).end();
    logger.info('[Payment Controller] Webhook processed successfully and acknowledged with 200.');

  } catch (error) {
    logger.error(`[Payment Controller] Webhook processing error: ${error.message}`, {
      stack: error.stack,
      details: { signature, rawBodySnippet: rawBodyString.substring(0, 100) + '...' }
    });

    if (error.message.includes('signature')) {
      res.status(401).end(); // Unauthorized for invalid signature
      logger.warn('[Payment Controller] Webhook rejected due to invalid signature.');
    } else {
      res.status(500).end(); // Internal server error for other failures
      logger.error('[Payment Controller] Webhook processing failed with a 500 error.');
    }
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
    // This is where you would call a new verification method from a service.
    // For now, this is a placeholder
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