// File: src/api/v1/payments/paystack.routes.js
const express = require('express');
const paystackController = require('./paystack.controller'); // Import the new Paystack controller

const router = express.Router();

// Endpoint for the Flutter app to request Paystack transaction initialization
router.post(
  '/initialize-transaction',
  paystackController.initializeTransaction
);

// Webhook endpoint for Paystack to send notifications
router.post(
  '/webhook',
  express.json({ verify: paystackController.rawBodySaver }), // Middleware to get raw body for signature verification
  paystackController.handlePaystackWebhook
);

module.exports = router;