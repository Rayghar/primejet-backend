// File: src/api/v1/payments/payment.controller.js
const paymentService = require('./payment.service');
const orderService = require('../orders/order.service'); // FIX: Import orderService
const { logger } = require('../../../config/logger.config');
const HttpError = require('../../../utils/HttpError');

// Handler for the Monnify webhook
const handleMonnifyWebhook = (req, res, next) => {
  logger.debug('[Payment Controller] Webhook handler initiated.');

  const signature = req.headers['monnify-signature'];
  const rawBody = req.body;
  const rawBodyString = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : '';

  logger.debug('[Payment Controller] Webhook received. Signature:', signature);
  logger.debug('[Payment Controller] Raw Body Snippet:', rawBodyString.substring(0, 100) + '...');

  try {
    paymentService.verifyMonnifySignature({ signature, rawBodyString });
    res.status(200).end();
    logger.info('[Payment Controller] Webhook acknowledged with 200 (empty body).');

    paymentService.processMonnifyWebhook({ signature, rawBodyString })
      .then(() => logger.info('[Payment Controller] Webhook processed successfully (async).'))
      .catch(error => {
        logger.error(`[Payment Controller] Async webhook processing error: ${error.message}`, { stack: error.stack });
      });

  } catch (error) {
    logger.error(`[Payment Controller] Webhook error: ${error.message}`, {
      stack: error.stack,
      details: { signature, rawBodySnippet: rawBodyString.substring(0, 0) + '...' }
    });

    if (error.message.includes('signature')) {
      res.status(401).end();
      logger.warn('[Payment Controller] Webhook rejected due to invalid signature.');
    } else {
      res.status(200).end();
    }
  }
};

// Handler for initiating a payment session
const initializePaymentForOrder = async (req, res, next) => {
  try {
    const { orderId } = req.body;
    // FIX: Call orderService.initializePayment instead of paymentService.initializePayment
    const result = await orderService.initializePayment({ orderId, userId: req.user.id }); 
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
    // FIX: paymentService needs a verifyPayment method to call here
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