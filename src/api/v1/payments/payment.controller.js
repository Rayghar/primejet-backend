// File: src/api/v1/payments/payment.controller.js
const paymentService = require('./payment.service');

const handleMonnifyWebhook = async (req, res, next) => {
  try {
    const signature = req.headers['monnify-signature'];
    await paymentService.processMonnifyWebhook({ signature, rawBody: req.body });
    res.sendStatus(200);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  handleMonnifyWebhook,
};