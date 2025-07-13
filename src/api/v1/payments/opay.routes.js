// File: src/api/v1/payments/opay.routes.js
const express = require('express');
const opayController = require('./opay.controller'); // Corrected import
const authMiddleware = require('../../../middleware/auth.middleware');
const validate = require('../../../middleware/validate.middleware');
const { initializeOpayPaymentSchema, verifyOpayPaymentSchema } = require('./opay.validation'); // Use OPay validation schemas

const router = express.Router();

// Route for initializing an OPay payment for an order (called by frontend)
router.post(
  '/opay/initialize',
  authMiddleware('customer'),
  validate(initializeOpayPaymentSchema),
  opayController.initializeOpayPaymentForOrder
);

// Route for OPay webhooks (publicly accessible, requires raw body for signature verification)
// Ensure this route is mounted BEFORE express.json() in app.js
router.post(
  '/opay/webhook',
  opayController.rawBodySaver, // Middleware to save raw body
  express.raw({ type: 'application/json' }), // Parse as raw for signature verification
  opayController.handleOpayWebhook
);

// Route for manual OPay transaction verification (optional, can be used for reconciliation)
router.post(
  '/opay/verify',
  authMiddleware('customer'), // Or 'admin' if only admins can manually verify
  validate(verifyOpayPaymentSchema),
  opayController.verifyOpayTransaction
);

module.exports = router;