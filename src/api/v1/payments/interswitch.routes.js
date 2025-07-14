// File: src/api/v1/payments/interswitch.routes.js
const express = require('express');
const interswitchController = require('./interswitch.controller'); // New Interswitch controller
const authMiddleware = require('../../../middleware/auth.middleware'); // Assuming authMiddleware is needed for APIs

const router = express.Router();

// Endpoint for the Flutter app to request Interswitch transaction verification (after client-side payment completion)
// This endpoint makes the server-to-server call to Interswitch to confirm payment.
// URL will be /api/v1/interswitch/verify-transaction
router.post(
  '/verify-transaction',
  authMiddleware(), // Authenticate the user making the request
  interswitchController.verifyTransaction
);

// Webhook endpoint for Interswitch to send notifications (IPN Service)
// URL will be /api/v1/interswitch/webhook
router.post(
  '/webhook',
  // Middleware to capture raw body for signature verification (if Interswitch provides it)
  // For Interswitch, we explicitly manage rawBody in controller if needed, as signature details are sparse.
  interswitchController.handleInterswitchWebhook
);

module.exports = router;