// File: src/api/v1/payments/payment.routes.js
const express = require('express');
const bodyParser = require('body-parser');
const paymentController = require('./payment.controller');
const validate = require('../../../middleware/validate.middleware');
const { initializePaymentSchema, verifyPaymentSchema } = require('./payment.validation');
const router = express.Router();

console.log('[PAYMENT_ROUTES] Registering payment routes...');

// Route for the Monnify webhook (server-to-server communication)
// This must use bodyParser.raw to get the raw body string for signature verification.
router.post(
  '/webhooks/monnify',
  bodyParser.raw({ type: 'application/json' }),
  paymentController.handleMonnifyWebhook
);

// New Route: For the frontend to initiate a payment session
// This route is called by your client-side app to start a payment.
router.post(
  '/initialize',
  validate(initializePaymentSchema),
  paymentController.initializePaymentForOrder
);

// New Route: For the frontend to verify a payment after completion
// This is an optional client-side verification route.
router.get(
  '/verify',
  validate(verifyPaymentSchema),
  paymentController.verifyPayment
);

console.log('[PAYMENT_ROUTES] Payment routes registered.');

module.exports = router;