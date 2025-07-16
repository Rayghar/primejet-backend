// File: src/api/v1/payments/payment.routes.js
// Note: This file is no longer strictly necessary if the webhook is the only payment route
// and is defined directly in app.js. However, keeping it provides better structure.
// Ensure this router is NOT mounted in app.js if you define the route there.
const express = require('express');
const paymentController = require('./payment.controller');

const router = express.Router();

// The webhook route is now defined directly in app.js to handle raw body parsing correctly.

module.exports = router;