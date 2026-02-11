// File: src/api/v1/utilities/power.routes.js
const express = require('express');
const router = express.Router();
const powerController = require('./power.controller');
const auth = require('../../../middleware/auth.middleware');

// ✅ auth.middleware.js is a factory -> must be invoked
router.use(auth());

// New: Get dynamic billers (used by Flutter for provider list)
router.get('/billers', powerController.getBillers);

router.post('/validate', powerController.validateMeter);
router.post('/order', powerController.createOrder);
router.post('/retry', powerController.retryVending);

module.exports = router;
