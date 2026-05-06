const express = require('express');
const router = express.Router();
const dataEntryController = require('./data-entry.controller');
const auth = require('../../../middleware/auth.middleware');
const reversalController = require('./reversals/reversal.controller');
const { requireBranchScope } = require('../../../middleware/branchScope.middleware');

const enforcePosBranchScope = requireBranchScope({ requireBranchForSelected: true, roles: ['cashier', 'plant_manager', 'operations_manager', 'finance_lead', 'manager', 'investor'] });

// Daily Summary lifecycle
router.post('/daily-summary', auth(), enforcePosBranchScope, dataEntryController.createOrGetSummary);
router.post('/daily-summary/get-or-create', auth(), enforcePosBranchScope, dataEntryController.createOrGetSummary);
router.put('/daily-summary/:summaryId/meters', auth(), dataEntryController.updateMeters);
router.patch('/daily-summary/:summaryId/meters', auth(), dataEntryController.updateMeters);
router.get('/daily-summary/entries', auth(), dataEntryController.getDailyEntries);
router.get('/daily-entries/:summaryId', auth(), dataEntryController.getDailyEntries);
router.post('/daily-summary/:summaryId/finalize', auth(), dataEntryController.finalizeSummary);
router.put('/daily-summary/:summaryId/finalize', auth(), dataEntryController.finalizeSummary);
router.post('/daily-summary/:summaryId/reopen', auth(['admin', 'manager', 'finance_lead']), dataEntryController.reopenDailySummary);
router.get('/daily-close/dashboard', auth(['admin', 'manager', 'finance_lead', 'cashier']), dataEntryController.getDailyCloseDashboard);
router.get('/daily-close/action-list', auth(['admin', 'manager', 'finance_lead', 'cashier']), dataEntryController.getDailyCloseActionList);
router.get('/daily-summary/:summaryId/receipts', auth(['admin', 'manager', 'finance_lead', 'cashier']), dataEntryController.getReceiptHistory);
router.get('/daily-summary/:summaryId/audit', auth(['admin', 'manager', 'finance_lead', 'cashier']), dataEntryController.getDailyCloseAuditTrail);
router.get('/daily-summary/:summaryId/control-pack', auth(['admin', 'manager', 'finance_lead', 'cashier']), dataEntryController.getDailyCloseControlPack);
router.get('/reversals', auth(['admin', 'manager', 'finance_lead', 'cashier']), reversalController.list);
router.post('/daily-summary/:summaryId/sales/:saleId/reversal-request', auth(['admin', 'manager', 'finance_lead', 'cashier']), reversalController.sale);
router.post('/daily-summary/:summaryId/expenses/:expenseId/reversal-request', auth(['admin', 'manager', 'finance_lead', 'cashier']), reversalController.expense);
router.post('/daily-summary/:summaryId/sales/:saleId/void', auth(['admin', 'manager', 'finance_lead', 'cashier']), dataEntryController.voidSaleEntry);
router.post('/daily-summary/:summaryId/expenses/:expenseId/void', auth(['admin', 'manager', 'finance_lead', 'cashier']), dataEntryController.voidExpenseEntry);
router.get('/daily-summary/:summaryId/report', auth(), dataEntryController.getSummaryReport);

// Sales and expenses: canonical GL-ready routes + legacy aliases
router.post('/daily-summary/:summaryId/sales', auth(), enforcePosBranchScope, dataEntryController.createSaleEntry);
router.post('/sales', auth(), enforcePosBranchScope, dataEntryController.createSaleEntry);
router.post('/daily-summary/:summaryId/expenses', auth(), enforcePosBranchScope, dataEntryController.createExpenseEntry);
router.post('/expenses', auth(), enforcePosBranchScope, dataEntryController.createExpenseEntry);

// Approval Queue
router.get("/daily-summary/open-days", auth(["admin", "manager", "finance_lead", "cashier"]), enforcePosBranchScope, dataEntryController.getOpenDailySummaries);
router.get('/daily-summary/pending-approval', auth(['admin', 'manager', 'finance_lead']), dataEntryController.getPendingSummariesForApproval);
router.get('/daily-summary/history', auth(['admin', 'manager', 'finance_lead']), dataEntryController.getDailySummaryHistory);
router.put('/daily-summary/:summaryId/approve', auth(['admin', 'manager', 'finance_lead']), dataEntryController.approveDailySummary);
router.post('/daily-summary/:summaryId/approve', auth(['admin', 'manager', 'finance_lead']), dataEntryController.approveDailySummary);
router.put('/daily-summary/:summaryId/reject', auth(['admin', 'manager', 'finance_lead']), dataEntryController.rejectDailySummary);
router.post('/daily-summary/:summaryId/reject', auth(['admin', 'manager', 'finance_lead']), dataEntryController.rejectDailySummary);

// History and migration
router.get('/transaction-history', auth(), dataEntryController.getTransactionHistory);
router.get('/transactions/history', auth(), dataEntryController.getTransactionHistory);
router.post('/migration/daily-summaries', auth(['admin']), dataEntryController.migrateDailySummaries);
router.post('/migration/expenses', auth(['admin']), dataEntryController.migrateExpenseTransactions);

module.exports = router;
