// File: src/api/v1/payments/payment.routes.js
// Note: This file is no longer mounted in app.js, as the route is defined directly
// to handle raw body parsing. You can keep it for structure or remove its usage.
const express = require('express');
const paymentController = require('./payment.controller');
const router = express.Router();

// The webhook route is now defined directly in app.js
// router.post('/monnify/webhook', ...);

module.exports = router;