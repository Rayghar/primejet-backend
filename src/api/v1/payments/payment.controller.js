// File: src/api/v1/payments/payment.controller.js
const paymentService = require('./payment.service');

const initializePaymentForOrder = async (req, res, next) => {
  try {
    const { orderId } = req.body;
    const result = await paymentService.initializePayment({ orderId, userId: req.user.id });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

const verifyPayment = async (req, res, next) => {
  try {
    const { reference, orderId } = req.body;
    const result = await paymentService.verifyPaystackTransaction({ reference, orderId });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

const handlePaystackWebhook = async (req, res, next) => {
  try {
    const signature = req.headers['x-paystack-signature'];
    // CORRECTED: Convert the raw body buffer to a string before processing
    await paymentService.processPaystackWebhook(req.body.toString(), signature);
    res.sendStatus(200); // Acknowledge receipt to Paystack
  } catch (error) {
    next(error);
  }
};

module.exports = {
  initializePaymentForOrder,
  handlePaystackWebhook,
  verifyPayment,
};