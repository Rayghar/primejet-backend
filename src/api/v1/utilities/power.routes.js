// File: src/api/v1/utilities/power.routes.js
const express = require('express');
const router = express.Router();
const powerController = require('./power.controller');
const auth = require('../../../middleware/auth.middleware');

// Protected Routes
router.post('/validate', auth, powerController.validateMeter);
router.post('/order', auth, powerController.createOrder);

// Admin-only retry (controller enforces role)
router.post('/retry', auth, powerController.retryVending);

// Requery VTpass transaction status (useful for ops/pending fixes)
router.post('/requery', auth, powerController.requery);

module.exports = router;