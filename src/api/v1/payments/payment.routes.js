// File: src/api/v1/payments/payment.routes.js
const express = require('express');
const bodyParser = require('body-parser'); // Added import for raw body parsing
const paymentController = require('./payment.controller');
const router = express.Router();

// Webhook route with raw body parsing middleware
router.post(
  '/monnify/webhook',
  bodyParser.raw({ type: 'application/json' }), // Added: Parses raw body as Buffer for signature verification
  paymentController.handleMonnifyWebhook
);

module.exports = router;