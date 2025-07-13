// File: src/api/v1/payments/payment.routes.js
const express = require('express');
const paymentController = require('./payment.controller');
const authMiddleware = require('../../../middleware/auth.middleware');
const validate = require('../../../middleware/validate.middleware');
const { initializePaymentSchema } = require('./payment.validation');

const router = express.Router();

// Route for initializing a payment for an order
router.post(
  '/initialize',
  authMiddleware('customer'),
  validate(initializePaymentSchema),
  paymentController.initializePaymentForOrder
);
// ADDED: New route for the client to ask the server to verify a transaction
router.post(
  '/verify',
  authMiddleware('customer'),
  // You should create a Joi schema to validate that 'reference' and 'orderId' are provided
  paymentController.verifyPayment
);

router.post(
  '/paystack/webhook',
  express.raw({ type: 'application/json' }),
  paymentController.handlePaystackWebhook
);


module.exports = router;