const express = require('express');
const router = express.Router();
const financeController = require('./finance.controller'); // Correct path
const auth = require('../../../middleware/auth.middleware'); // This line is crucial and the path is correct

// All routes will be prefixed with /api/v2/finance

// Get manager's sales view data (daily, weekly, cumulative)
router.get('/sales', auth(), financeController.getManagerSalesView);

// Mark cash from a summary as paid to bank (placeholder)
router.post('/sales/:summaryId/cash-paid', auth(), financeController.markCashPaidToBank);

module.exports = router;