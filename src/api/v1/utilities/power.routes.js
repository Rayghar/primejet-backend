// File: src/api/v1/utilities/power.routes.js
const express = require('express');
const router = express.Router();
const powerController = require('./power.controller');
const auth = require('../../../middleware/auth.middleware');

// Protected routes
router.post('/validate', auth, powerController.validateMeter);
router.post('/order', auth, powerController.createOrder);

// Admin retry + requery
router.post('/retry', auth, powerController.retryVending);
router.post('/requery', auth, powerController.requery);

module.exports = router;
