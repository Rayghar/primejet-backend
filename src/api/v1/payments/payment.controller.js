// File: src/api/v1/payments/payment.controller.js
const paymentService = require('./payment.service');
const { logger } = require('../../../config/logger.config');
const HttpError = require('../../../utils/HttpError');

const handleMonnifyWebhook = async (req, res, next) => {
  logger.debug('[Payment Controller] Webhook handler initiated.');

  try {
    const signature = req.headers['monnify-signature'];
    const rawBodyString = req.body ? req.body.toString('utf8') : '';

    await paymentService.processMonnifyWebhook({ signature, rawBodyString });

    res.status(200).end();  // Success ack
    logger.info('[Payment Controller] Webhook processed successfully.');

  } catch (error) {
    if (error.message.includes('signature')) {  // Signature fail: 401 to reject
      res.status(401).end();
      logger.error('Webhook rejected: Invalid signature.');
    } else {  // All other errors (e.g., mismatch): Log but ack 200 to stop retries
      logger.error(`Webhook processing error (acknowledged anyway): ${error.message}`);
      res.status(200).end();
    }
  }
};

module.exports = { handleMonnifyWebhook };