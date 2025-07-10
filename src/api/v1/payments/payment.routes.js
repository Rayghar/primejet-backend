// File: src/api/v1/payments/payment.routes.js
const express = require('express');
const paymentController = require('./payment.controller');

const router = express.Router();

// This is the single endpoint for receiving webhook events from Flutterwave's servers.
router.post(
  '/flutterwave/webhook',
  paymentController.handleFlutterwaveWebhook
);

module.exports = router;