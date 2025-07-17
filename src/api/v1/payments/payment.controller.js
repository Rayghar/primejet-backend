// File: src/api/v1/payments/payment.controller.js
const paymentService = require('./payment.service');
const { logger } = require('../../../config/logger.config');
const HttpError = require('../../../utils/HttpError');

const handleMonnifyWebhook = async (req, res, next) => {
  logger.debug('[Payment Controller] Webhook handler initiated.'); // Debug log: First line of handler

  try {
    const signature = req.headers['monnify-signature'];
    // req.rawBody is available because bodyParser.raw is used for this route
    const rawBodyString = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body);

    logger.debug('[Payment Controller] Received Webhook Headers:', JSON.stringify(req.headers)); // Debug log: All headers
    logger.debug('[Payment Controller] Received Webhook Raw Body (string):', rawBodyString); // Debug log: Raw body
    logger.debug('[Payment Controller] Extracted Monnify-Signature:', signature); // Debug log: Extracted signature

    await paymentService.processMonnifyWebhook({ signature, rawBodyString });

    res.status(200).json({ status: 'success', message: 'Webhook received and processed successfully.' });
    logger.info('[Payment Controller] Webhook successfully processed and acknowledged with 200 OK.'); // Info log for successful path

  } catch (error) {
    let statusCode = 500;
    let errorMessage = 'Internal server error processing webhook.';

    if (error instanceof HttpError) {
      statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
      errorMessage = error.message;
      logger.error(`[Payment Controller] Caught HttpError in webhook handler: Status ${statusCode}, Message: ${errorMessage}`, { stack: error.stack, originalError: error });
    } else {
      logger.error('[Payment Controller] Caught unexpected non-HttpError in webhook handler:', {
        error: error.message,
        stack: error.stack,
        originalError: error,
        requestHeaders: req.headers,
        requestBody: req.body,
        rawBodyString: req.rawBody ? req.rawBody.toString('utf8') : 'N/A',
      });
      // Fallback to 500 and generic message for unexpected errors
    }

    res.status(statusCode).json({ status: 'error', message: errorMessage });
    logger.warn(`[Payment Controller] Webhook processing failed. Sent HTTP ${statusCode} to Monnify. Error: ${errorMessage}`); // Warning log for failed path
  }
};

module.exports = {
  handleMonnifyWebhook,
};