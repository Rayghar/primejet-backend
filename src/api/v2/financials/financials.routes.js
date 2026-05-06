// src/api/v2/financials/financials.routes.js
const express = require('express');
const financialsController = require('./financials.controller');
const authMiddleware = require('../../../middleware/auth.middleware');
const { requirePermission } = require('../../../middleware/permission.middleware');
const { requireBranchScope } = require('../../../middleware/branchScope.middleware');

const router = express.Router();
const enforceInvestorBranchScope = requireBranchScope({ requireBranchForSelected: true, roles: ['investor'] });

// Endpoint to get all financial statement data with server-side calculations.
router.get('/statements', authMiddleware(['admin', 'finance_lead', 'owner', 'investor', 'auditor', 'accountant']), enforceInvestorBranchScope, financialsController.getFinancialStatements);
router.get('/migration-reconciliation', authMiddleware(['admin', 'manager', 'finance_lead', 'owner', 'investor', 'auditor', 'accountant']), enforceInvestorBranchScope, financialsController.getMigrationReconciliationReport);

// Endpoint to get revenue assurance report
router.get('/revenue-assurance', authMiddleware(['admin', 'finance_lead', 'owner', 'investor', 'auditor', 'accountant']), enforceInvestorBranchScope, financialsController.getRevenueAssuranceReport);

// NEW: Endpoint to get tax compliance report
router.get('/tax-compliance', authMiddleware(['admin', 'finance_lead', 'owner', 'investor', 'auditor', 'accountant']), enforceInvestorBranchScope, financialsController.getTaxComplianceReport);
router.get('/cash-movement', authMiddleware(['admin', 'manager', 'finance_lead', 'owner', 'investor', 'auditor', 'accountant']), enforceInvestorBranchScope, financialsController.getCashMovementReport);
router.get('/expense-analysis', authMiddleware(['admin', 'manager', 'finance_lead', 'owner', 'investor', 'auditor', 'accountant']), enforceInvestorBranchScope, financialsController.getExpenseAnalysisReport);
router.get('/branch-pl', authMiddleware(['admin', 'manager', 'finance_lead', 'owner', 'investor', 'auditor', 'accountant']), enforceInvestorBranchScope, financialsController.getBranchProfitLossReport);
router.get('/source-trace', authMiddleware(['admin', 'manager', 'finance_lead', 'owner', 'investor', 'auditor', 'accountant']), enforceInvestorBranchScope, financialsController.getSourceTraceReport);
router.get('/wallet-liability', authMiddleware(['admin', 'manager', 'finance_lead', 'owner', 'investor', 'auditor', 'accountant']), enforceInvestorBranchScope, financialsController.getWalletLiabilityReport);
router.get('/failed-payments', authMiddleware(['admin', 'manager', 'finance_lead', 'owner', 'investor', 'auditor', 'accountant']), enforceInvestorBranchScope, financialsController.getFailedPaymentReviewQueue);

// Wave 11A — Optional manual settlement and revenue assurance controls.
// These controls are advisory only and must not block POS, approval, GL posting or financial statements.
router.get('/settlement-dashboard', authMiddleware(['admin', 'manager', 'finance_lead', 'owner', 'investor', 'auditor', 'accountant']), enforceInvestorBranchScope, financialsController.getSettlementDashboard);
router.get('/settlements', authMiddleware(['admin', 'manager', 'finance_lead', 'owner', 'investor', 'auditor', 'accountant']), enforceInvestorBranchScope, financialsController.getSettlementConfirmations);
router.post('/settlements/confirm', authMiddleware(['admin', 'manager', 'finance_lead']), requirePermission('finance.settlement.manage'), financialsController.confirmSettlement);
router.get('/settlements/export', authMiddleware(['admin', 'manager', 'finance_lead', 'owner', 'investor', 'auditor', 'accountant']), enforceInvestorBranchScope, financialsController.exportSettlements);
router.post('/statement-uploads', authMiddleware(['admin', 'manager', 'finance_lead', 'accountant']), requirePermission('finance.settlement.manage'), financialsController.createStatementUpload);
router.get('/statement-uploads', authMiddleware(['admin', 'manager', 'finance_lead', 'owner', 'investor', 'auditor', 'accountant']), enforceInvestorBranchScope, financialsController.listStatementUploads);
router.get('/revenue-leakage', authMiddleware(['admin', 'manager', 'finance_lead', 'owner', 'investor', 'auditor', 'accountant']), enforceInvestorBranchScope, financialsController.getRevenueLeakageDashboard);
router.get('/export', authMiddleware(['admin', 'manager', 'finance_lead', 'owner', 'investor', 'auditor', 'accountant']), enforceInvestorBranchScope, financialsController.exportFinancialReport);

module.exports = router;