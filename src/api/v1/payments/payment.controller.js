// File: src/api/v1/payments/payment.controller.js
const paymentService = require('./payment.service');

const handleFlutterwaveWebhook = async (req, res, next) => {
  try {
    // The signature is passed in the 'verif-hash' header by Flutterwave.
    const signature = req.headers['verif-hash'];
    await paymentService.processFlutterwaveWebhook({ signature, body: req.body });
    
    // Always send a 200 OK to acknowledge receipt to Flutterwave.
    res.sendStatus(200); 
  } catch (error) {
    // Let the central error handler manage logging and the response.
    next(error);
  }
};

module.exports = {
  handleFlutterwaveWebhook,
};