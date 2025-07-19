// File: src/api/v1/payments/payment.controller.js
const paymentService = require('./payment.service');
const { logger } = require('../../../config/logger.config');
const HttpError = require('../../../utils/HttpError');

const handleMonnifyWebhook = (req, res, next) => {  // Sync handler (no async)
  logger.debug('[Payment Controller] Webhook handler initiated.');

  const signature = req.headers['monnify-signature'];
  const rawBody = req.body;  // Buffer from bodyParser.raw
  const rawBodyString = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : '';

  logger.debug('[Payment Controller] Webhook received. Signature:', signature);
  logger.debug('[Payment Controller] Raw Body Snippet:', rawBodyString.substring(0, 100) + '...');

  try {
    // Quick verification (sync)
    paymentService.verifyMonnifySignature({ signature, rawBodyString });  // Throws on invalid

    // Acknowledge immediately
    res.status(200).end();
    logger.info('[Payment Controller] Webhook acknowledged with 200 (empty body).');

    // Process async (fire-and-forget)
    paymentService.processMonnifyWebhook({ signature, rawBodyString })
      .then(() => logger.info('[Payment Controller] Webhook processed successfully (async).'))
      .catch(error => {
        logger.error(`[Payment Controller] Async webhook processing error: ${error.message}`, { stack: error.stack });
      });

  } catch (error) {
    logger.error(`[Payment Controller] Webhook error: ${error.message}`, {
      stack: error.stack,
      details: { signature, rawBodySnippet: rawBodyString.substring(0, 100) + '...' }
    });

    if (error.message.includes('signature')) {
      res.status(401).end();
      logger.warn('[Payment Controller] Webhook rejected due to invalid signature.');
    } else {
      res.status(200).end();  // Ack for other errors
    }
  }
};

module.exports = { handleMonnifyWebhook };