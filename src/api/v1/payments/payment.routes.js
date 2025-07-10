// File: src/api/v1/payments/payment.routes.js
const express = require('express');
const paymentController = require('./payment.controller');

const router = express.Router();

// Existing Flutterwave webhook endpoint
router.post(
  '/flutterwave/webhook',
  paymentController.handleFlutterwaveWebhook
);

// --- NEW: Monnify Webhook Endpoint ---
// This is the endpoint for receiving webhook events from Monnify's servers.
router.post(
  '/monnify/webhook', // Define the specific path for Monnify webhooks
  express.json({ verify: paymentController.rawBodySaver }), // Use a custom body parser to get raw body for hash validation
  paymentController.handleMonnifyWebhook // New controller function for Monnify
);

module.exports = router;