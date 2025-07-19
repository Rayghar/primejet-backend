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
    res.status(200).end();  // Always ack 200 on success
    logger.info('[Payment Controller] Webhook processed successfully.');

  } catch (error) {
    logger.error(`Webhook processing error: ${error.message}`, {
      stack: error.stack,
      details: { signature, rawBody: rawBodyString.substring(0, 100) + '...' }
    });
    if (error.message.includes('signature')) {
      res.status(401).end();  // Reject only on signature fail
      logger.warn('Webhook rejected due to invalid signature.');
    } else {
      res.status(200).end();  // Ack 200 for all other errors to stop retries
    }
  }
};

module.exports = { handleMonnifyWebhook };