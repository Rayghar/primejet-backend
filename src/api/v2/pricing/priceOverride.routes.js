// src/api/v2/pricing/priceOverride.routes.js
const express = require('express');
const auth = require('../../../middleware/auth.middleware');
const ctrl = require('./priceOverride.controller');
const router = express.Router();
router.get('/overrides', auth(['admin', 'manager', 'finance_lead', 'cashier']), ctrl.list);
router.post('/overrides/request', auth(['admin', 'manager', 'finance_lead', 'cashier']), ctrl.request);
router.post('/overrides/:overrideId/approve', auth(['admin', 'manager', 'finance_lead']), ctrl.approve);
router.post('/overrides/:overrideId/reject', auth(['admin', 'manager', 'finance_lead']), ctrl.reject);
module.exports = router;
