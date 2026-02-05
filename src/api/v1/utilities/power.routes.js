// File: src/api/v1/utilities/power.routes.js
const express = require('express');
const router = express.Router();
const powerController = require('./power.controller');
const auth = require('../../../middleware/auth.middleware');

// Apply Auth Middleware (User must be logged in)
router.use(auth);

router.post('/validate', powerController.validateMeter);
router.post('/order', powerController.createOrder);
router.post('/retry', powerController.retryVending);

module.exports = router;
