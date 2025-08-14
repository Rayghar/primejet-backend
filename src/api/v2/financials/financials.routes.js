// src/api/v2/financials/financials.routes.js
const express = require('express');
const financialsController = require('./financials.controller');
const authMiddleware = require('../../../middleware/auth.middleware');

const router = express.Router();

// Endpoint to get all financial statement data with server-side calculations.
router.get('/statements', authMiddleware(['admin', 'finance_lead']), financialsController.getFinancialStatements);

// Endpoint to get revenue assurance report
router.get('/revenue-assurance', authMiddleware(['admin', 'finance_lead']), financialsController.getRevenueAssuranceReport);

// NEW: Endpoint to get tax compliance report
router.get('/tax-compliance', authMiddleware(['admin', 'finance_lead']), financialsController.getTaxComplianceReport);

module.exports = router;