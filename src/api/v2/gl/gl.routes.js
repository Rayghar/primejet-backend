// File: src/api/v2/gl/gl.routes.js

const express = require('express');
const authMiddleware = require('../../../middleware/auth.middleware');
const gl = require('./gl.controller');
const { requirePermission } = require('../../../middleware/permission.middleware');
const { requireBranchScope } = require('../../../middleware/branchScope.middleware');

const router = express.Router();
const enforceInvestorBranchScope = requireBranchScope({ requireBranchForSelected: true, roles: ['investor'] });

// Help / field guidance
router.get('/help', authMiddleware(['admin', 'manager', 'finance_lead', 'owner', 'investor', 'auditor', 'accountant']), enforceInvestorBranchScope, gl.getHelpCatalog);

// GL reference data
router.get('/coa', authMiddleware(['admin', 'manager', 'finance_lead', 'owner', 'investor', 'auditor', 'accountant']), enforceInvestorBranchScope, gl.getCOA);

// GL setup/bootstrap
router.post('/bootstrap', authMiddleware(['admin', 'finance_lead']), requirePermission('finance.opening-balance.manage'), gl.bootstrapCOA);

// GL operational health, journal drilldown and reversal
router.get('/health', authMiddleware(['admin', 'manager', 'finance_lead', 'owner', 'investor', 'auditor', 'accountant']), enforceInvestorBranchScope, gl.getHealth);
router.get('/confidence', authMiddleware(['admin', 'manager', 'finance_lead', 'owner', 'investor', 'auditor', 'accountant']), enforceInvestorBranchScope, gl.getFinanceConfidence);
router.get('/readiness', authMiddleware(['admin', 'manager', 'finance_lead', 'owner', 'investor', 'auditor', 'accountant']), enforceInvestorBranchScope, gl.getReadiness);
router.post('/readiness/run-safe-setup', authMiddleware(['admin', 'finance_lead']), requirePermission('finance.gl.post'), gl.runSafeSetup);
router.get('/journals', authMiddleware(['admin', 'manager', 'finance_lead', 'owner', 'investor', 'auditor', 'accountant']), enforceInvestorBranchScope, gl.listJournals);
router.get('/posting-batches', authMiddleware(['admin', 'manager', 'finance_lead', 'owner', 'investor', 'auditor', 'accountant']), enforceInvestorBranchScope, gl.listPostingBatches);
router.get('/posting-batches/:batchId/export', authMiddleware(['admin', 'manager', 'finance_lead', 'owner', 'investor', 'auditor', 'accountant']), enforceInvestorBranchScope, gl.exportPostingBatch);
router.get('/posting-batches/:batchId', authMiddleware(['admin', 'manager', 'finance_lead', 'owner', 'investor', 'auditor', 'accountant']), enforceInvestorBranchScope, gl.getPostingBatchDetail);
router.get('/periods', authMiddleware(['admin', 'manager', 'finance_lead', 'owner', 'investor', 'auditor', 'accountant']), enforceInvestorBranchScope, gl.listPeriods);
router.post('/periods/lock', authMiddleware(['admin', 'finance_lead']), requirePermission('finance.period.lock'), gl.lockPeriod);
router.post('/periods/reopen', authMiddleware(['admin', 'finance_lead']), requirePermission('finance.period.lock'), gl.reopenPeriod);
router.post('/periods/generate', authMiddleware(['admin', 'finance_lead']), requirePermission('finance.period.lock'), gl.generateFiscalPeriods);
router.get('/journals/export', authMiddleware(['admin', 'manager', 'finance_lead', 'owner', 'investor', 'auditor', 'accountant']), enforceInvestorBranchScope, gl.exportJournals);
router.get('/journals/:journalId', authMiddleware(['admin', 'manager', 'finance_lead', 'owner', 'investor', 'auditor', 'accountant']), enforceInvestorBranchScope, gl.getJournalDetail);
router.post('/reverse', authMiddleware(['admin', 'finance_lead']), requirePermission('finance.gl.reverse.approve'), gl.reverseJournal);
router.get('/reversal-requests', authMiddleware(['admin', 'manager', 'finance_lead', 'owner', 'investor', 'auditor', 'accountant']), enforceInvestorBranchScope, gl.listReversalRequests);
router.post('/reversal-requests', authMiddleware(['admin', 'finance_lead']), requirePermission('finance.gl.reverse.request'), gl.requestReversal);
router.post('/reversal-requests/:requestId/approve', authMiddleware(['admin', 'finance_lead']), requirePermission('finance.gl.reverse.approve'), gl.approveReversalRequest);
router.post('/reversal-requests/:requestId/reject', authMiddleware(['admin', 'finance_lead']), requirePermission('finance.gl.reverse.approve'), gl.rejectReversalRequest);


// Rebuild journals from operational data
// Long-running rebuilds should use /rebuild/jobs so the UI can poll progress and avoid HTTP timeouts.
router.get('/rebuild/jobs', authMiddleware(['admin', 'finance_lead']), requirePermission('finance.gl.rebuild'), gl.listGlRebuildJobs);
router.post('/rebuild/jobs', authMiddleware(['admin', 'finance_lead']), requirePermission('finance.gl.rebuild'), gl.startGlRebuildJob);
router.get('/rebuild/jobs/:jobId', authMiddleware(['admin', 'finance_lead']), requirePermission('finance.gl.rebuild'), gl.getGlRebuildJob);

// Controlled GL reset/purge jobs. Use before a clean rebuild when old journals were posted under obsolete policies.
router.get('/reset/verify', authMiddleware(['admin', 'finance_lead']), requirePermission('finance.gl.rebuild'), gl.verifyGlReset);
router.get('/reset/jobs', authMiddleware(['admin', 'finance_lead']), requirePermission('finance.gl.rebuild'), gl.listGlResetJobs);
router.post('/reset/jobs', authMiddleware(['admin', 'finance_lead']), requirePermission('finance.gl.rebuild'), gl.startGlResetJob);
router.get('/reset/jobs/:jobId', authMiddleware(['admin', 'finance_lead']), requirePermission('finance.gl.rebuild'), gl.getGlResetJob);

// Legacy direct rebuild endpoint remains for scripts/backward compatibility.
// Example: POST /api/v2/gl/rebuild?startDate=2025-06-01&endDate=2025-08-31
// Optional: &branchId=... or &serviceZoneId=...&dryRun=true
router.post('/rebuild', authMiddleware(['admin', 'finance_lead']), requirePermission('finance.gl.rebuild'), gl.rebuild);

// Day-to-day posting flow (GL-first)
// Post all approved sources for a business date
// Example: POST /api/v2/gl/post-approved?date=2025-08-31&branchId=...
router.post('/post-approved', authMiddleware(['admin', 'finance_lead']), requirePermission('finance.gl.post'), gl.postApprovedForDate);

// Retry failures within a range
// Example: POST /api/v2/gl/retry-failed?startDate=2025-06-01&endDate=2025-08-31
router.post('/retry-failed', authMiddleware(['admin', 'finance_lead']), requirePermission('finance.gl.retry'), gl.retryFailedPostings);

// Inspect posting exceptions (grouped by reason)
// Example: GET /api/v2/gl/posting-exceptions?startDate=2025-06-01&endDate=2025-08-31
router.get('/posting-exceptions', authMiddleware(['admin', 'manager', 'finance_lead', 'owner', 'investor', 'auditor', 'accountant']), enforceInvestorBranchScope, gl.getPostingExceptions);
router.get('/approved-unposted', authMiddleware(['admin', 'manager', 'finance_lead', 'owner', 'investor', 'auditor', 'accountant']), enforceInvestorBranchScope, gl.listApprovedUnpostedSources);
router.post('/approve-discrepancy', authMiddleware(['admin', 'finance_lead']), requirePermission('finance.gl.post'), gl.approveSourceDiscrepancy);

// Trial balance
// Example: GET /api/v2/gl/trial-balance?startDate=2025-06-01&endDate=2025-08-31
router.get('/trial-balance', authMiddleware(['admin', 'manager', 'finance_lead', 'owner', 'investor', 'auditor', 'accountant']), enforceInvestorBranchScope, gl.getTrialBalance);

module.exports = router;