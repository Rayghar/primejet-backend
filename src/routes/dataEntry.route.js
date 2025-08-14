const express = require('express');
const router = express.Router();
const dataEntryController = require('../controllers/dataEntry.controller');
const auth = require('../middlewares/auth');

// All routes will be prefixed with /api/v2/data-entry

// Create or get today's daily summary
router.post('/daily-summary', auth(), dataEntryController.createOrGetSummary);

// Update meter readings for a daily summary
router.put('/daily-summary/:summaryId/meters', auth(), dataEntryController.updateMeters);

// Log a new sale transaction
router.post('/sales', auth(), dataEntryController.createSaleEntry);

// Log a new expense
router.post('/expenses', auth(), dataEntryController.createExpenseEntry);

// Get all daily entries (sales and expenses) for a summary
router.get('/daily-entries/:summaryId', auth(), dataEntryController.getDailyEntries);

// Finalize a daily summary
router.put('/daily-summary/:summaryId/finalize', auth(), dataEntryController.finalizeSummary);

// Get a full daily summary report
router.get('/daily-summary/:summaryId/report', auth(), dataEntryController.getSummaryReport);

module.exports = router;