// File: src/api/v1/payments/payment.controller.js
const paymentService = require('./payment.service');

const handleMonnifyWebhook = async (req, res, next) => {
  try {
    const signature = req.headers['monnify-signature'];
    // req.body is the raw buffer due to the middleware in app.js
    await paymentService.processMonnifyWebhook({ signature, rawBody: req.body });
    
    // Always acknowledge receipt with a 200 OK status.
    res.sendStatus(200); 
  } catch (error) {
    next(error);
  }
};

module.exports = {
  handleMonnifyWebhook,
};