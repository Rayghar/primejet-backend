const express = require('express');
const router = express.Router();
const dataEntryController = require('./data-entry.controller');
const auth = require('../../../middleware/auth.middleware');

// Cashier Daily Log Endpoints
router.post('/daily-summary', auth(), (req, res, next) => {
    console.debug('[DEBUG] Router: Raw request body for /daily-summary:', JSON.stringify(req.body, null, 2));
    next();
}, dataEntryController.createOrGetSummary);
router.put('/daily-summary/:summaryId/meters', auth(), dataEntryController.updateMeters);
router.post('/sales', auth(), (req, res, next) => {
    console.debug('[DEBUG] Router: Raw request body for /sales:', JSON.stringify(req.body, null, 2));
    next();
}, dataEntryController.createSaleEntry);
router.post('/expenses', auth(), (req, res, next) => {
    console.debug('[DEBUG] Router: Raw request body for /expenses:', JSON.stringify(req.body, null, 2));
    next();
}, dataEntryController.createExpenseEntry);
router.get('/daily-entries/:summaryId', auth(), dataEntryController.getDailyEntries);
router.put('/daily-summary/:summaryId/finalize', auth(), dataEntryController.finalizeSummary);
router.get('/daily-summary/:summaryId/report', auth(), dataEntryController.getSummaryReport);

// Approval Queue (Manager)
router.get('/daily-summary/pending-approval', auth(['admin', 'manager']), dataEntryController.getPendingSummariesForApproval);
router.put('/daily-summary/:summaryId/approve', auth(['admin', 'manager']), dataEntryController.approveDailySummary);
router.put('/daily-summary/:summaryId/reject', auth(['admin', 'manager']), dataEntryController.rejectDailySummary);

// Transaction History & Data Migration
router.get('/transaction-history', auth(), dataEntryController.getTransactionHistory);
router.post('/migration/daily-summaries', auth(['admin']), dataEntryController.migrateDailySummaries);
router.post('/migration/expenses', auth(['admin']), dataEntryController.migrateExpenseTransactions);

module.exports = router;