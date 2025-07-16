// File: src/api/v1/payments/payment.controller.js
const paymentService = require('./payment.service');
const { logger } = require('../../../config/logger.config');

const handleMonnifyWebhook = async (req, res, next) => {
  try {
    // Acknowledge receipt immediately to Monnify's server 
    res.sendStatus(200);

    const signature = req.headers['monnify-signature'];
    
    // Process the logic in the background
    await paymentService.processMonnifyWebhook({ signature, rawBody: req.body });

  } catch (error) {
    // Even if an error occurs, we've already sent a 200 status.
    // We log the error for internal review.
    logger.error('[Payment Controller] Error processing Monnify webhook:', {
      error: error.message,
      stack: error.stack,
    });
  }
};

module.exports = {
  handleMonnifyWebhook,
};