// src/api/v2/opening-balances/openingBalance.routes.js
const express = require('express');
const auth = require('../../../middleware/auth.middleware');
const ctrl = require('./openingBalance.controller');
const router = express.Router();

router.get('/', auth(['admin', 'finance_lead', 'manager']), ctrl.list);
router.get('/readiness', auth(['admin', 'finance_lead', 'manager']), ctrl.readiness);
router.post('/draft', auth(['admin', 'finance_lead']), ctrl.draft);
router.post('/:id/submit', auth(['admin', 'finance_lead']), ctrl.submit);
router.post('/:id/post', auth(['admin', 'finance_lead']), ctrl.post);

module.exports = router;
