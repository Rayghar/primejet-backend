// File: src/api/v1/payments/payment.controller.js
const paymentService = require('./payment.service');
const { logger } = require('../../../config/logger.config');
const HttpError = require('../../../utils/HttpError'); // Import HttpError

const handleMonnifyWebhook = async (req, res, next) => {
  try {
    const signature = req.headers['monnify-signature'];
    // req.rawBody is available because a raw body parser middleware is used for this route (see app.js)
    const rawBodyString = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body); // Ensure it's a string

    logger.debug('[Payment Controller] Monnify webhook received. Headers:', req.headers); // Log all headers
    logger.debug('[Payment Controller] Monnify webhook raw body:', rawBodyString); // Log the raw body for full inspection
    logger.debug('[Payment Controller] Monnify webhook signature header:', signature); // Log the signature explicitly

    // Process the logic. The service will handle signature verification.
    await paymentService.processMonnifyWebhook({ signature, rawBodyString });

    // If processing is successful (including verification), send a 200 OK JSON response.
    res.status(200).json({ status: 'success', message: 'Webhook received and processed successfully.' });
    logger.info('[Payment Controller] Monnify webhook successfully processed and acknowledged with 200 OK.');

  } catch (error) {
    // If an HttpError (e.g., 401 for invalid signature, 400 for bad payload)
    // or any other error occurs, log it and send an appropriate status back to Monnify.
    logger.error('[Payment Controller] Error processing Monnify webhook:', {
      error: error.message,
      stack: error.stack,
      requestHeaders: req.headers, // Include headers for debugging webhook issues
      requestBody: req.body, // Log parsed body (if available)
      rawBodyString: req.rawBody ? req.rawBody.toString('utf8') : 'N/A', // Log raw body string if it caused the issue
    });

    if (error instanceof HttpError) {
      res.status(error.statusCode).json({ status: 'error', message: error.message });
      logger.warn(`[Payment Controller] Sent HTTP ${error.statusCode} to Monnify due to error: ${error.message}`);
    } else {
      res.status(500).json({ status: 'error', message: 'Internal server error processing webhook.' });
      logger.error('[Payment Controller] Sent HTTP 500 to Monnify due to unexpected error.');
    }
  }
};

module.exports = {
  handleMonnifyWebhook,
};