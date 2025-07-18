// File: src/api/v1/payments/payment.controller.js
const paymentService = require('./payment.service');
const { logger } = require('../../../config/logger.config');
const HttpError = require('../../../utils/HttpError');

const handleMonnifyWebhook = async (req, res, next) => {
  logger.debug('[Payment Controller] Webhook handler initiated.'); // Debug log: First line of handler

  // --- Deeper X-Ray Debugging of Request Body ---
  logger.debug(`[Payment Controller] Raw Body (Buffer) type: ${typeof req.rawBody}`);
  if (req.rawBody instanceof Buffer) {
      logger.debug(`[Payment Controller] Raw Body (Buffer) length: ${req.rawBody.length} bytes.`);
      logger.debug(`[Payment Controller] Raw Body (Buffer) content: ${req.rawBody.toString('utf8').substring(0, 200)}...`); // Log first 200 chars
  } else {
      logger.debug(`[Payment Controller] req.rawBody is NOT a Buffer. Value: ${req.rawBody}`); // Should ideally be a Buffer
  }

  logger.debug(`[Payment Controller] Parsed Body (req.body) type: ${typeof req.body}`);
  if (req.body && Object.keys(req.body).length > 0) {
      logger.debug(`[Payment Controller] Parsed Body (req.body) content: ${JSON.stringify(req.body).substring(0, 200)}...`); // Log first 200 chars
  } else {
      logger.debug(`[Payment Controller] Parsed Body (req.body) is empty or not parsed. Value: ${req.body}`);
  }
  // --- End Deeper X-Ray Debugging ---


  try {
    const signature = req.headers['monnify-signature'];
    // Use req.rawBody.toString('utf8') as the canonical string for hashing
    const rawBodyString = req.rawBody ? req.rawBody.toString('utf8') : ''; // Ensure it's a string, even if Buffer is empty

    logger.debug('[Payment Controller] Extracted Monnify-Signature from Headers:', signature);
    logger.debug('[Payment Controller] FULL Stringified Request Body for Hashing (from req.rawBody.toString(\'utf8\')): ' + rawBodyString);  // TEMPORARY: Log FULL string for debugging (REMOVE AFTER TESTING to avoid sensitive data in logs)

    await paymentService.processMonnifyWebhook({ signature, rawBodyString });

    res.status(200).json({ status: 'success', message: 'Webhook received and processed successfully.' });
    logger.info('[Payment Controller] Webhook successfully processed and acknowledged with 200 OK.');

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
        requestBody: req.body, // The potentially empty parsed body
        rawBodyString: req.rawBody ? req.rawBody.toString('utf8') : 'N/A', // The string form of raw body
      });
      // Fallback to 500 and generic message
    }

    res.status(statusCode).json({ status: 'error', message: errorMessage });
    logger.warn(`[Payment Controller] Webhook processing failed. Sent HTTP ${statusCode} to Monnify. Error: ${errorMessage}`);
  }
};

module.exports = {
  handleMonnifyWebhook,
};