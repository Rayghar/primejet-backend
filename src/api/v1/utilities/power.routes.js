// File: src/api/v1/utilities/power.routes.js
const express = require('express');
const router = express.Router();
const powerController = require('./power.controller');
const auth = require('../../../middleware/auth.middleware'); 

// Protected Routes
router.post('/validate', auth, powerController.validateMeter);
router.post('/order', auth, powerController.createOrder);

// --- NEW ROUTE: Admin Retry ---
router.post('/retry', auth, powerController.retryVending);

module.exports = router;