// File: src/api/v2/gl/gl.controller.js

const mongoose = require('mongoose');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');

const ChartOfAccount = require('../../../models/chartOfAccount.model');
const GeneralLedgerEntry = require('../../../models/generalLedgerEntry.model');
const DailySummary = require('../../../models/dailySummary.model');
const ExpenseTransaction = require('../../../models/expenseTransaction.model');
const StockIn = require('../../../models/stockIn.model');
const Order = require('../../../models/order.model');
const Plant = require('../../../models/plant.model');
const User = require('../../../models/user.model');
const AccountingPeriod = require('../../../models/accountingPeriod.model');
const PostingBatch = require('../../../models/postingBatch.model');
const GLReversalRequest = require('../../../models/glReversalRequest.model');
const BranchPrice = require('../../../models/branchPrice.model');
const BranchStockConfig = require('../../../models/branchStockConfig.model');
const StockReconciliation = require('../../../models/stockReconciliation.model');

const posting = require('./posting.service');
const glRebuildJobs = require('./glRebuildJob.service');
const glResetJobs = require('./glResetJob.service');
const { DEFAULT_ACCOUNTS } = require('./services/coaMapping.service');
const { GL_HELP_CATALOG, flattenHelpCatalog } = require('./helpCatalog');

const {
  bootstrap,
  rebuild: rebuildPosting,
  postApproved,
  retryFailed,
  postingExceptions,
  trialBalance: trialBalanceService,
  postReversal,
  listPostingBatches: listPostingBatchesService,
  assertPeriodOpenForDate,
} = posting;

const safeNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const asBool = (v, defaultValue = false) => {
  if (v === undefined || v === null || v === '') return Boolean(defaultValue);
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(s)) return true;
  if (['false', '0', 'no', 'n'].includes(s)) return false;
  return Boolean(defaultValue);
};

const glOrderScopeMeta = (includeOrders = false) => ({
  includeOrders: Boolean(includeOrders),
  policy: Boolean(includeOrders)
    ? 'Orders are included because includeOrders=true was explicitly requested.'
    : 'Orders are excluded from GL posting readiness/rebuild by default. App/customer orders remain operational records and are not posted to GL unless explicitly enabled.',
});

const parseBusinessDate = (d) => {
  if (!d) return null;
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const [y, m, day] = d.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, day, 0, 0, 0, 0));
  }
  const x = new Date(d);
  return x && !Number.isNaN(x.getTime()) ? x : null;
};

const toISODate = (d) => parseBusinessDate(d);

const startOfDay = (d) => {
  const x = parseBusinessDate(d) || new Date();
  x.setUTCHours(0, 0, 0, 0);
  return x;
};

const endOfDay = (d) => {
  const x = parseBusinessDate(d) || new Date();
  x.setUTCHours(23, 59, 59, 999);
  return x;
};

const branchKeyFromReq = (req) => req.query.branchId || req.query.serviceZoneId || req.body?.branchId || req.body?.serviceZoneId || null;

const isObjectId = (v) => mongoose.Types.ObjectId.isValid(String(v || ''));
const objectIdOf = (v) => new mongoose.Types.ObjectId(String(v));

const byDateRange = (field, dateMatch) => {
  if (!dateMatch || !Object.keys(dateMatch).length) return {};
  return { [field]: dateMatch };
};

const dailyBranchFilter = (branchKey) => {
  if (!branchKey) return {};
  if (isObjectId(branchKey)) return { branchId: objectIdOf(branchKey) };
  // DailySummary.branchId is an ObjectId in this codebase. A non-ObjectId branch key cannot match safely.
  return { _id: null };
};

const stringBranchFilter = (branchKey) => (branchKey ? { branchId: String(branchKey) } : {});

const orderBranchFilter = (branchKey) => {
  if (!branchKey) return {};
  const s = String(branchKey);
  const ors = [{ serviceZoneId: s }, { zoneId: s }, { plantId: s }];
  if (isObjectId(s)) ors.push({ branchId: objectIdOf(s) });
  return { $or: ors };
};

const mergeAnd = (...parts) => {
  const clean = parts.filter((p) => p && Object.keys(p).length);
  if (clean.length === 0) return {};
  if (clean.length === 1) return clean[0];
  return { $and: clean };
};

const orderDateRangeFilter = (dateMatch) => {
  if (!dateMatch || !Object.keys(dateMatch).length) return {};
  return {
    $or: [
      { orderDate: dateMatch },
      { orderDate: { $exists: false }, createdAt: dateMatch },
    ],
  };
};


const resolveBranchCandidates = async (branchKey) => {
  if (!branchKey) return { strings: [], objectIds: [], plant: null };
  const s = String(branchKey).trim();
  const strings = new Set([s]);
  const objectIds = new Map();
  const addOid = (v) => {
    if (v && mongoose.Types.ObjectId.isValid(String(v))) objectIds.set(String(v), objectIdOf(v));
  };
  const addString = (v) => {
    if (v !== undefined && v !== null && String(v).trim() !== '') strings.add(String(v).trim());
  };
  addOid(s);
  let plant = null;
  try {
    const ors = [{ id: s }, { name: s }];
    if (isObjectId(s)) ors.push({ _id: objectIdOf(s) });
    plant = await Plant.findOne({ $or: ors }).lean();
  } catch (_) {
    plant = null;
  }
  if (plant) {
    addOid(plant._id);
    addString(plant._id);
    addString(plant.id);
    addString(plant.name);
  }
  return { strings: [...strings], objectIds: [...objectIds.values()], plant };
};

const buildSourceBranchFilters = async (branchKey) => {
  if (!branchKey) return { daily: {}, stock: {}, expense: {}, order: {}, gl: {}, displayKey: null };
  const c = await resolveBranchCandidates(branchKey);
  const stringIn = c.strings.length ? { $in: c.strings } : null;
  const oidIn = c.objectIds.length ? { $in: c.objectIds } : null;
  const daily = oidIn ? { branchId: oidIn } : { _id: { $exists: false } };
  const stock = stringIn ? { branchId: stringIn } : { _id: { $exists: false } };
  const expense = stringIn ? { branchId: stringIn } : { _id: { $exists: false } };
  const orderOr = [];
  if (oidIn) orderOr.push({ branchId: oidIn });
  if (stringIn) orderOr.push({ serviceZoneId: stringIn }, { zoneId: stringIn }, { plantId: stringIn }, { branchKey: stringIn });
  const order = orderOr.length ? { $or: orderOr } : { _id: { $exists: false } };
  const gl = stringIn ? { branchKey: stringIn } : { _id: { $exists: false } };
  return { daily, stock, expense, order, gl, displayKey: c.plant?._id ? String(c.plant._id) : String(branchKey), strings: c.strings, objectIds: c.objectIds };
};


const REQUIRED_ACCOUNT_CODES = Object.freeze([
  DEFAULT_ACCOUNTS.CASH_ON_HAND,
  DEFAULT_ACCOUNTS.BANK_TRANSFERS,
  DEFAULT_ACCOUNTS.BANK_POS,
  DEFAULT_ACCOUNTS.ACCOUNTS_PAYABLE,
  DEFAULT_ACCOUNTS.SALES_POS,
  DEFAULT_ACCOUNTS.STAFF_COSTS,
  DEFAULT_ACCOUNTS.LOGISTICS_FUEL,
  DEFAULT_ACCOUNTS.UTILITIES,
  DEFAULT_ACCOUNTS.MAINTENANCE,
  DEFAULT_ACCOUNTS.MARKETING,
  DEFAULT_ACCOUNTS.ADMIN_GENERAL,
].filter(Boolean));

const RECOMMENDED_ACCOUNT_CODES = Object.freeze([
  DEFAULT_ACCOUNTS.CASH_OVER_SHORT,
  DEFAULT_ACCOUNTS.ACCOUNTS_RECEIVABLE,
  DEFAULT_ACCOUNTS.INVENTORY_LPG,
  DEFAULT_ACCOUNTS.TAX_PAYABLE,
  DEFAULT_ACCOUNTS.SALES_DELIVERY,
  DEFAULT_ACCOUNTS.COGS_LPG,
  DEFAULT_ACCOUNTS.SHARE_CAPITAL,
  DEFAULT_ACCOUNTS.RETAINED_EARNINGS,
].filter(Boolean));

const statusOfControl = (passed, warning = false) => {
  if (passed) return warning ? 'WARNING' : 'PASSED';
  return 'FAILED';
};

const makeControl = ({ key, label, type = 'MANDATORY', passed, warning = false, message, remediation, action, count, meta }) => ({
  key,
  label,
  type,
  status: statusOfControl(Boolean(passed), Boolean(warning)),
  passed: Boolean(passed),
  message,
  remediation: remediation || null,
  action: action || null,
  count: count === undefined ? null : count,
  meta: meta || {},
});

const countSourcePostings = async ({ dateMatch, branchKey, includeOrders = false }) => {
  const dailyBase = mergeAnd(dailyBranchFilter(branchKey), byDateRange('date', dateMatch));
  const expenseBase = mergeAnd(stringBranchFilter(branchKey), byDateRange('date', dateMatch));
  const stockBase = mergeAnd(stringBranchFilter(branchKey), byDateRange('purchaseDate', dateMatch));
  const orderBase = includeOrders ? mergeAnd(orderBranchFilter(branchKey), orderDateRangeFilter(dateMatch)) : null;

  const failedStatus = { 'posting.status': 'FAILED' };
  const postedStatus = { 'posting.status': 'POSTED' };
  const approvedDaily = { status: 'approved' };
  const approvedExpense = { status: { $in: ['approved', 'Approved', 'APPROVED'] } };
  const deliveredOrder = { status: 'Delivered' };

  const [
    failedDailyCount,
    failedExpenseCount,
    failedStockCount,
    approvedSummaries,
    approvedExpenses,
    eligibleStockIns,
    postedSummaries,
    postedExpenses,
    postedStockIns,
  ] = await Promise.all([
    DailySummary.countDocuments(mergeAnd(dailyBase, failedStatus)),
    ExpenseTransaction.countDocuments(mergeAnd(expenseBase, failedStatus)),
    StockIn.countDocuments(mergeAnd(stockBase, failedStatus)),
    DailySummary.countDocuments(mergeAnd(dailyBase, approvedDaily)),
    ExpenseTransaction.countDocuments(mergeAnd(expenseBase, approvedExpense)),
    StockIn.countDocuments(stockBase),
    DailySummary.countDocuments(mergeAnd(dailyBase, approvedDaily, postedStatus)),
    ExpenseTransaction.countDocuments(mergeAnd(expenseBase, approvedExpense, postedStatus)),
    StockIn.countDocuments(mergeAnd(stockBase, postedStatus)),
  ]);

  let failedOrderCount = 0;
  let deliveredOrders = 0;
  let postedOrders = 0;
  if (includeOrders && orderBase) {
    [failedOrderCount, deliveredOrders, postedOrders] = await Promise.all([
      Order.countDocuments(mergeAnd(orderBase, failedStatus)),
      Order.countDocuments(mergeAnd(orderBase, deliveredOrder)),
      Order.countDocuments(mergeAnd(orderBase, deliveredOrder, postedStatus)),
    ]);
  }

  const failedPostingCount = failedDailyCount + failedExpenseCount + failedStockCount + (includeOrders ? failedOrderCount : 0);
  const eligibleSourceCount = approvedSummaries + approvedExpenses + eligibleStockIns + (includeOrders ? deliveredOrders : 0);
  const postedEligibleSourceCount = postedSummaries + postedExpenses + postedStockIns + (includeOrders ? postedOrders : 0);
  const unpostedApprovedCount = Math.max(0, eligibleSourceCount - postedEligibleSourceCount);

  return {
    failedPostingCount,
    eligibleSourceCount,
    postedEligibleSourceCount,
    unpostedApprovedCount,
    glOrderScope: glOrderScopeMeta(includeOrders),
    sourcePostingCounts: {
      failed: {
        dailySummaries: failedDailyCount,
        expenses: failedExpenseCount,
        stockIns: failedStockCount,
        orders: includeOrders ? failedOrderCount : 0,
        ordersExcluded: includeOrders ? 0 : null,
        total: failedPostingCount,
      },
      eligible: {
        dailySummaries: approvedSummaries,
        expenses: approvedExpenses,
        stockIns: eligibleStockIns,
        orders: includeOrders ? deliveredOrders : 0,
        ordersExcluded: includeOrders ? 0 : null,
        total: eligibleSourceCount,
      },
      posted: {
        dailySummaries: postedSummaries,
        expenses: postedExpenses,
        stockIns: postedStockIns,
        orders: includeOrders ? postedOrders : 0,
        ordersExcluded: includeOrders ? 0 : null,
        total: postedEligibleSourceCount,
      },
    },
  };
};

const buildReadinessPayload = async (req) => {
  const { startDate, endDate } = req.query || {};
  const branchKey = branchKeyFromReq(req);
  const includeOrders = asBool(req.query?.includeOrders, false);

  const dateMatch = {};
  if (startDate) dateMatch.$gte = startOfDay(startDate);
  if (endDate) dateMatch.$lte = endOfDay(endDate);
  const hasDateScope = Object.keys(dateMatch).length > 0;

  const glMatch = hasDateScope ? { date: dateMatch } : {};
  if (branchKey) glMatch.branchKey = String(branchKey);

  const accountCodesToCheck = [...new Set([...REQUIRED_ACCOUNT_CODES, ...RECOMMENDED_ACCOUNT_CODES])];
  const [
    coaRows,
    plantCount,
    adminUserCount,
    activeUserCount,
    anyStockCount,
    pricedStockCount,
    recentDailyWithPrice,
    postedJournalCount,
    lastPosted,
    postingCounts,
  ] = await Promise.all([
    ChartOfAccount.find({ accountCode: { $in: accountCodesToCheck }, isActive: true }).select('accountCode name type normalBalance category').lean(),
    Plant.countDocuments({ status: { $ne: 'Offline' } }),
    User.countDocuments({ role: 'admin', status: { $ne: 'inactive' } }),
    User.countDocuments({ status: { $ne: 'inactive' } }),
    StockIn.countDocuments(branchKey ? stringBranchFilter(branchKey) : {}),
    StockIn.countDocuments(mergeAnd(branchKey ? stringBranchFilter(branchKey) : {}, { targetSalePricePerKg: { $gt: 0 }, costPerKg: { $gt: 0 } })),
    DailySummary.countDocuments(mergeAnd(branchKey ? dailyBranchFilter(branchKey) : {}, { pricePerKg: { $gt: 0 } })),
    GeneralLedgerEntry.countDocuments({ ...glMatch, status: 'POSTED' }),
    GeneralLedgerEntry.findOne({ ...glMatch, status: 'POSTED' }).sort({ createdAt: -1 }).select('createdAt date sourceType sourceId').lean(),
    countSourcePostings({ dateMatch, branchKey, includeOrders }),
  ]);

  const foundCodes = new Set(coaRows.map((r) => String(r.accountCode)));
  const missingRequiredAccounts = REQUIRED_ACCOUNT_CODES.filter((code) => !foundCodes.has(String(code)));
  const missingRecommendedAccounts = RECOMMENDED_ACCOUNT_CODES.filter((code) => !foundCodes.has(String(code)));

  let tb = null;
  if (startDate && endDate && typeof trialBalanceService === 'function') {
    tb = await trialBalanceService({ startDate, endDate, branchId: branchKey });
  }

  const mandatoryControls = [
    makeControl({
      key: 'coa_bootstrap',
      label: 'Chart of Accounts Bootstrap',
      type: 'MANDATORY',
      passed: foundCodes.size > 0,
      message: foundCodes.size > 0 ? `${foundCodes.size} required/recommended COA accounts found.` : 'Chart of Accounts has not been bootstrapped.',
      remediation: 'Run GL Bootstrap before posting to GL.',
      action: { label: 'Run GL Bootstrap', method: 'POST', endpoint: '/api/v2/gl/bootstrap' },
      count: foundCodes.size,
    }),
    makeControl({
      key: 'required_gl_accounts',
      label: 'Required GL Accounts',
      type: 'MANDATORY',
      passed: missingRequiredAccounts.length === 0,
      message: missingRequiredAccounts.length === 0 ? 'All required posting accounts are available.' : `Missing required accounts: ${missingRequiredAccounts.join(', ')}`,
      remediation: 'Run GL Bootstrap. If still missing, review the COA seed/mapping configuration.',
      action: { label: 'Run GL Bootstrap', method: 'POST', endpoint: '/api/v2/gl/bootstrap' },
      count: REQUIRED_ACCOUNT_CODES.length - missingRequiredAccounts.length,
      meta: { required: REQUIRED_ACCOUNT_CODES, missing: missingRequiredAccounts },
    }),
    makeControl({
      key: 'branch_plant_setup',
      label: 'Branch / Plant Setup',
      type: 'MANDATORY',
      passed: plantCount > 0,
      message: plantCount > 0 ? `${plantCount} active plant/branch record(s) found.` : 'No active plant/branch record found.',
      remediation: 'Create at least one active plant/branch before posting daily sales.',
      action: { label: 'Go to Plant Setup', view: 'PlantStatus' },
      count: plantCount,
    }),
    makeControl({
      key: 'admin_approver_role',
      label: 'Admin / Approver Access',
      type: 'MANDATORY',
      passed: adminUserCount > 0,
      warning: adminUserCount > 0 && activeUserCount < 2,
      message: adminUserCount > 0 ? `${adminUserCount} active admin user(s) can approve/post.` : 'No active admin user found for approval and GL posting.',
      remediation: 'Create/enable an admin user. For segregation of duties, configure separate cashier and approver users where possible.',
      action: { label: 'Review Users', view: 'UserManagement' },
      count: adminUserCount,
      meta: { activeUserCount },
    }),
    makeControl({
      key: 'payment_method_gl_accounts',
      label: 'Payment Method GL Accounts',
      type: 'MANDATORY',
      passed: [DEFAULT_ACCOUNTS.CASH_ON_HAND, DEFAULT_ACCOUNTS.BANK_TRANSFERS, DEFAULT_ACCOUNTS.BANK_POS, DEFAULT_ACCOUNTS.ACCOUNTS_PAYABLE].every((code) => foundCodes.has(String(code))),
      message: 'Cash, transfer, POS and unpaid/payable postings require mapped GL accounts.',
      remediation: 'Run GL Bootstrap to create payment method posting accounts.',
      action: { label: 'Run GL Bootstrap', method: 'POST', endpoint: '/api/v2/gl/bootstrap' },
      meta: { required: [DEFAULT_ACCOUNTS.CASH_ON_HAND, DEFAULT_ACCOUNTS.BANK_TRANSFERS, DEFAULT_ACCOUNTS.BANK_POS, DEFAULT_ACCOUNTS.ACCOUNTS_PAYABLE] },
    }),
    makeControl({
      key: 'expense_category_mapping',
      label: 'Expense Category Mapping',
      type: 'MANDATORY',
      passed: [DEFAULT_ACCOUNTS.STAFF_COSTS, DEFAULT_ACCOUNTS.LOGISTICS_FUEL, DEFAULT_ACCOUNTS.UTILITIES, DEFAULT_ACCOUNTS.MAINTENANCE, DEFAULT_ACCOUNTS.MARKETING, DEFAULT_ACCOUNTS.ADMIN_GENERAL].every((code) => foundCodes.has(String(code))),
      message: 'Staff, logistics/fuel, utilities, maintenance, marketing and admin expense mappings are available when these accounts exist.',
      remediation: 'Run GL Bootstrap to create expense posting accounts.',
      action: { label: 'Run GL Bootstrap', method: 'POST', endpoint: '/api/v2/gl/bootstrap' },
    }),
  ];

  const recommendedControls = [
    makeControl({
      key: 'recommended_gl_accounts',
      label: 'Recommended GL Accounts',
      type: 'RECOMMENDED',
      passed: missingRecommendedAccounts.length === 0,
      warning: missingRecommendedAccounts.length > 0,
      message: missingRecommendedAccounts.length === 0 ? 'All recommended control/reporting accounts exist.' : `Recommended accounts missing: ${missingRecommendedAccounts.join(', ')}`,
      remediation: 'Run GL Bootstrap to add reporting/control accounts for inventory, COGS, receivables, tax and equity.',
      action: { label: 'Run GL Bootstrap', method: 'POST', endpoint: '/api/v2/gl/bootstrap' },
      meta: { missing: missingRecommendedAccounts },
    }),
    makeControl({
      key: 'opening_stock_loaded',
      label: 'Opening Stock / Stock-In Loaded',
      type: 'RECOMMENDED',
      passed: anyStockCount > 0,
      warning: anyStockCount === 0,
      message: anyStockCount > 0 ? `${anyStockCount} stock-in/opening stock record(s) found.` : 'No stock-in/opening stock record found. Revenue posting can continue, but inventory/COGS controls will be incomplete.',
      remediation: 'Load opening stock or record stock-in before relying on inventory and gross margin reports.',
      action: { label: 'Load Stock', view: 'Inventory' },
      count: anyStockCount,
    }),
    makeControl({
      key: 'product_price_setup',
      label: 'LPG Price / Product Cost Basis',
      type: 'RECOMMENDED',
      passed: pricedStockCount > 0 || recentDailyWithPrice > 0,
      warning: !(pricedStockCount > 0 || recentDailyWithPrice > 0),
      message: pricedStockCount > 0 || recentDailyWithPrice > 0 ? 'Pricing/cost basis detected from stock-in or daily summaries.' : 'No pricing/cost basis detected yet.',
      remediation: 'Configure LPG price per kg or record stock-in with cost/sale price values.',
      action: { label: 'Configure Operations', view: 'Inventory' },
      meta: { pricedStockCount, dailySummariesWithPrice: recentDailyWithPrice },
    }),
    makeControl({
      key: 'trial_balance_status',
      label: 'Trial Balance Status',
      type: 'RECOMMENDED',
      passed: tb ? Boolean(tb.ok) : true,
      warning: tb ? !Boolean(tb.ok) : false,
      message: tb ? (tb.ok ? 'Trial balance is balanced for the selected period.' : `Trial balance is not balanced. Difference: ${safeNum(tb.diff, 0)}`) : 'Select a start and end date to validate trial balance.',
      remediation: 'Review journals and posting exceptions before using financial statements for sign-off.',
      action: { label: 'View Trial Balance', view: 'TrialBalance' },
      meta: { diff: tb ? safeNum(tb.diff, 0) : null },
    }),
    makeControl({
      key: 'failed_postings',
      label: 'Failed Source Postings',
      type: 'RECOMMENDED',
      passed: postingCounts.failedPostingCount === 0,
      warning: postingCounts.failedPostingCount > 0,
      message: postingCounts.failedPostingCount === 0 ? 'No failed source postings found.' : `${postingCounts.failedPostingCount} source posting(s) have failed and require attention.`,
      remediation: 'Open posting exceptions, correct source data, then retry failed postings.',
      action: { label: 'Retry Failed Postings', method: 'POST', endpoint: '/api/v2/gl/retry-failed' },
      count: postingCounts.failedPostingCount,
    }),
  ];

  const mandatoryFailed = mandatoryControls.filter((c) => !c.passed);
  const mandatoryWarnings = mandatoryControls.filter((c) => c.status === 'WARNING');
  const recommendedWarnings = recommendedControls.filter((c) => c.status === 'WARNING' || !c.passed);

  const mandatoryPassed = mandatoryControls.filter((c) => c.passed).length;
  const recommendedPassed = recommendedControls.filter((c) => c.passed).length;
  const mandatoryWeight = 70;
  const recommendedWeight = 30;
  const readinessScore = Math.round(
    (mandatoryControls.length ? (mandatoryPassed / mandatoryControls.length) * mandatoryWeight : mandatoryWeight) +
    (recommendedControls.length ? (recommendedPassed / recommendedControls.length) * recommendedWeight : recommendedWeight)
  );

  const status = mandatoryFailed.length > 0 ? 'BLOCKED' : (mandatoryWarnings.length > 0 || recommendedWarnings.length > 0 ? 'WARNING' : 'READY');

  const blockedReasons = mandatoryFailed.map((c) => c.message);
  const warnings = [
    ...mandatoryWarnings.map((c) => c.message),
    ...recommendedWarnings.map((c) => c.message),
  ];

  return {
    ok: status !== 'BLOCKED',
    status,
    readinessScore,
    period: { startDate: startDate || null, endDate: endDate || null },
    branch: { branchId: branchKey || null },
    mandatoryPassed,
    mandatoryTotal: mandatoryControls.length,
    recommendedPassed,
    recommendedTotal: recommendedControls.length,
    controls: [...mandatoryControls, ...recommendedControls],
    mandatoryControls,
    recommendedControls,
    counts: {
      coaAccountsFound: foundCodes.size,
      coaAccountsChecked: accountCodesToCheck.length,
      plants: plantCount,
      adminUsers: adminUserCount,
      activeUsers: activeUserCount,
      stockRecords: anyStockCount,
      pricedStockRecords: pricedStockCount,
      postedJournalCount,
      approvedUnposted: postingCounts.unpostedApprovedCount,
      failedPostings: postingCounts.failedPostingCount,
      eligibleSources: postingCounts.eligibleSourceCount,
      postedEligibleSources: postingCounts.postedEligibleSourceCount,
      trialBalanceBalanced: tb ? Boolean(tb.ok) : null,
      trialBalanceDiff: tb ? safeNum(tb.diff, 0) : null,
      lastPostedAt: lastPosted?.createdAt || null,
    },
    sourcePostingCounts: postingCounts.sourcePostingCounts,
    glOrderScope: postingCounts.glOrderScope || glOrderScopeMeta(includeOrders),
    blockedReasons,
    warnings,
    openIssues: [...mandatoryControls, ...recommendedControls]
      .filter((c) => !c.passed || c.status === 'WARNING')
      .map((c) => ({ key: c.key, label: c.label, severity: c.type === 'MANDATORY' ? 'BLOCKER' : 'WARNING', message: c.message, remediation: c.remediation, action: c.action })),
    lastSuccessfulPostingDate: lastPosted?.date || lastPosted?.createdAt || null,
    actions: {
      bootstrapCOA: { method: 'POST', endpoint: '/api/v2/gl/bootstrap' },
      runSafeSetup: { method: 'POST', endpoint: '/api/v2/gl/readiness/run-safe-setup' },
      postApproved: { method: 'POST', endpoint: '/api/v2/gl/post-approved' },
      retryFailed: { method: 'POST', endpoint: '/api/v2/gl/retry-failed' },
      trialBalance: { method: 'GET', endpoint: '/api/v2/gl/trial-balance' },
      journals: { method: 'GET', endpoint: '/api/v2/gl/journals' },
      financialStatements: { view: 'FinancialStatements' },
    },
  };
};


const getHelpCatalog = async (req, res, next) => {
  try {
    return res.json({ ok: true, catalog: GL_HELP_CATALOG, items: flattenHelpCatalog() });
  } catch (e) {
    logger.error('[GL] help catalog error', e);
    return next(new HttpError(500, 'Failed to fetch GL help catalog'));
  }
};

const resolveSourcePreview = async (journal) => {
  if (!journal || !journal.sourceType || !journal.sourceId) return null;
  const id = String(journal.sourceId);
  const q = mongoose.Types.ObjectId.isValid(id) ? { _id: new mongoose.Types.ObjectId(id) } : { _id: id };
  const sourceType = String(journal.sourceType).toUpperCase();
  try {
    if (sourceType === 'DAILY_SUMMARY') {
      const doc = await DailySummary.findOne(q).select('_id date branchId cashierId status totals cashTotal transferTotal posTotal posting createdAt updatedAt').lean();
      return doc ? { sourceType, document: doc } : null;
    }
    if (sourceType === 'EXPENSE') {
      const doc = await ExpenseTransaction.findOne(q).select('_id date branchId category amount paymentMethod status posting description createdAt updatedAt').lean();
      return doc ? { sourceType, document: doc } : null;
    }
    if (sourceType === 'STOCK_IN') {
      const doc = await StockIn.findOne(q).select('_id branchId supplierName purchaseDate quantityKg costPerKg totalCost paymentDisposition posting createdAt updatedAt').lean();
      return doc ? { sourceType, document: doc } : null;
    }
    if (sourceType === 'ORDER') {
      const doc = await Order.findOne(q).select('_id orderNumber status branchId serviceZoneId plantId totalAmount amountPaid paymentMethod orderDate createdAt updatedAt posting').lean();
      return doc ? { sourceType, document: doc } : null;
    }
    return null;
  } catch (e) {
    return { sourceType, error: e.message || 'Unable to load source preview' };
  }
};

const getJournalDetail = async (req, res, next) => {
  try {
    const journalId = req.params.journalId || req.query.journalId;
    if (!journalId || !mongoose.Types.ObjectId.isValid(String(journalId))) {
      return next(new HttpError(400, 'Valid journalId is required'));
    }
    const journal = await GeneralLedgerEntry.findById(journalId).lean();
    if (!journal) return next(new HttpError(404, 'GL journal not found'));
    const [sourcePreview, reversalRequests, reversalEntry] = await Promise.all([
      resolveSourcePreview(journal),
      GLReversalRequest.find({ journalId: journal._id }).sort({ createdAt: -1 }).lean(),
      journal.reversalEntryId ? GeneralLedgerEntry.findById(journal.reversalEntryId).select('_id date sourceType narration status totals createdAt').lean() : Promise.resolve(null),
    ]);
    return res.json({
      ok: true,
      journal,
      sourcePreview,
      reversalRequests,
      reversalEntry,
      controls: {
        balanced: safeNum(journal?.totals?.diff, 0) <= 0.5,
        reversed: String(journal?.status || '').toUpperCase() === 'REVERSED',
        hasSource: Boolean(sourcePreview),
        canRequestReversal: String(journal?.status || '').toUpperCase() === 'POSTED',
      },
    });
  } catch (e) {
    logger.error('[GL] journal detail error', e);
    return next(new HttpError(500, e.message || 'Failed to fetch journal detail'));
  }
};

const getPostingBatchDetail = async (req, res, next) => {
  try {
    const batchId = req.params.batchId || req.query.batchId;
    if (!batchId) return next(new HttpError(400, 'batchId is required'));
    const batch = await PostingBatch.findOne({ batchId: String(batchId) }).lean();
    if (!batch) return next(new HttpError(404, 'Posting batch not found'));
    const journalObjectIds = (batch.journalIds || []).filter((id) => mongoose.Types.ObjectId.isValid(String(id))).map((id) => new mongoose.Types.ObjectId(String(id)));
    const journals = journalObjectIds.length
      ? await GeneralLedgerEntry.find({ _id: { $in: journalObjectIds } }).select('_id date periodKey branchKey sourceType sourceId entryType narration status totals createdAt').sort({ date: 1, createdAt: 1 }).lean()
      : [];
    const resultSummary = (batch.results || []).reduce((acc, r) => {
      const status = String(r?.status || 'UNKNOWN').toUpperCase();
      const sourceType = String(r?.sourceType || 'UNKNOWN').toUpperCase();
      acc.byStatus[status] = (acc.byStatus[status] || 0) + 1;
      acc.bySource[sourceType] = (acc.bySource[sourceType] || 0) + 1;
      return acc;
    }, { byStatus: {}, bySource: {} });
    return res.json({ ok: true, batch, journals, resultSummary });
  } catch (e) {
    logger.error('[GL] posting batch detail error', e);
    return next(new HttpError(500, e.message || 'Failed to fetch posting batch detail'));
  }
};

const exportPostingBatch = async (req, res, next) => {
  try {
    const batchId = req.params.batchId || req.query.batchId;
    if (!batchId) return next(new HttpError(400, 'batchId is required'));
    const batch = await PostingBatch.findOne({ batchId: String(batchId) }).lean();
    if (!batch) return next(new HttpError(404, 'Posting batch not found'));
    const esc = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const header = ['BatchId','Action','BatchStatus','Branch','BusinessDate','SourceType','SourceId','ResultStatus','ReasonCode','JournalIds'];
    const lines = [header.map(esc).join(',')];
    (batch.results || []).forEach((r) => {
      lines.push([
        batch.batchId,
        batch.action,
        batch.status,
        batch.branchKey || '',
        batch.businessDate ? new Date(batch.businessDate).toISOString().slice(0, 10) : '',
        r?.sourceType || '',
        r?.sourceId || '',
        r?.status || '',
        r?.reasonCode || '',
        Array.isArray(r?.glEntryIds) ? r.glEntryIds.join('|') : '',
      ].map(esc).join(','));
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="posting_batch_' + String(batch.batchId).replace(/[^a-zA-Z0-9_-]/g, '_') + '.csv"');
    return res.send(lines.join('\n')); 
  } catch (e) {
    return next(new HttpError(500, e.message || 'Failed to export posting batch'));
  }
};

const getCOA = async (req, res, next) => {
  try {
    const rows = await ChartOfAccount.find({ isActive: true }).sort({ accountCode: 1 }).lean();
    return res.json(rows);
  } catch (e) {
    logger.error('[GL] getCOA error', e);
    return next(new HttpError(500, 'Failed to fetch COA'));
  }
};

const bootstrapCOA = async (req, res, next) => {
  try {
    if (typeof bootstrap !== 'function') return next(new HttpError(501, 'GL bootstrap is not available'));
    const result = await bootstrap();
    return res.json({ ok: true, ...result });
  } catch (e) {
    logger.error('[GL] bootstrap error', e);
    return next(new HttpError(500, e.message || 'Failed to bootstrap COA'));
  }
};

const rebuild = async (req, res, next) => {
  try {
    const payload = { ...(req.body || {}), ...(req.query || {}) };
    const { startDate, endDate, dryRun } = payload;
    const branchKey = branchKeyFromReq(req);
    if (!startDate || !endDate) return next(new HttpError(400, 'startDate and endDate are required'));
    if (typeof rebuildPosting !== 'function') return next(new HttpError(501, 'GL rebuild is not available'));
    if (!toISODate(startDate) || !toISODate(endDate)) return next(new HttpError(400, 'Invalid startDate or endDate'));

    const result = await rebuildPosting({
      startDate,
      endDate,
      branchId: branchKey,
      dryRun: String(dryRun || '').toLowerCase() === 'true',
      postedBy: req.user?.email || req.user?.id || req.user?._id || 'system',
      settlementMode: payload.settlementMode,
      historicalStockFundingMode: payload.historicalStockFundingMode,
      historicalCogsMode: payload.historicalCogsMode,
      forceExpensePaymentAccount: payload.forceExpensePaymentAccount,
      accountingPolicy: payload.accountingPolicy,
      includeOrders: asBool(payload.includeOrders, false),
    });
    return res.json({ ok: true, ...result });
  } catch (e) {
    logger.error('[GL] rebuild error', e);
    return next(new HttpError(500, e.message || 'GL rebuild failed'));
  }
};

const startGlRebuildJob = async (req, res, next) => {
  try {
    const payload = { ...(req.body || {}), ...(req.query || {}) };
    const startDate = payload.startDate;
    const endDate = payload.endDate;
    if (!startDate || !endDate) return next(new HttpError(400, 'startDate and endDate are required'));
    if (!toISODate(startDate) || !toISODate(endDate)) return next(new HttpError(400, 'Invalid startDate or endDate'));
    const branchKey = branchKeyFromReq(req) || payload.branchId || payload.branchIdOrZoneId || payload.serviceZoneId || null;
    const job = glRebuildJobs.startGlRebuildJob({
      startDate,
      endDate,
      branchId: branchKey,
      dryRun: payload.dryRun,
      settlementMode: payload.settlementMode || process.env.GL_REBUILD_SETTLEMENT_MODE || 'SAME_DAY',
      historicalStockFundingMode: payload.historicalStockFundingMode || process.env.GL_HISTORICAL_STOCK_FUNDING_MODE || 'BANK',
      historicalCogsMode: payload.historicalCogsMode || process.env.GL_HISTORICAL_COGS_MODE || 'STOCK_PURCHASE_FULL_COST',
      forceExpensePaymentAccount: payload.forceExpensePaymentAccount || process.env.GL_REBUILD_FORCE_EXPENSE_PAYMENT_ACCOUNT || 'BANK',
      accountingPolicy: payload.accountingPolicy || 'OPTION_C_BANK_CENTRIC_WORKING_CAPITAL',
      includeOrders: asBool(payload.includeOrders, false),
    }, req.user || {});
    return res.status(202).json({ ok: true, job });
  } catch (e) {
    logger.error('[GL] start rebuild job error', e);
    return next(new HttpError(500, e.message || 'Failed to start GL rebuild job'));
  }
};

const getGlRebuildJob = async (req, res, next) => {
  try {
    const job = glRebuildJobs.getGlRebuildJob(req.params.jobId);
    if (!job) return next(new HttpError(404, 'GL rebuild job not found. The server may have restarted or the job id is invalid.'));
    return res.json({ ok: true, job });
  } catch (e) {
    return next(new HttpError(500, e.message || 'Failed to fetch GL rebuild job'));
  }
};

const listGlRebuildJobs = async (req, res, next) => {
  try {
    return res.json({ ok: true, jobs: glRebuildJobs.listGlRebuildJobs() });
  } catch (e) {
    return next(new HttpError(500, e.message || 'Failed to fetch GL rebuild jobs'));
  }
};


const startGlResetJob = async (req, res, next) => {
  try {
    const payload = { ...(req.body || {}), ...(req.query || {}) };
    const startDate = payload.startDate;
    const endDate = payload.endDate;
    if (!startDate || !endDate) return next(new HttpError(400, 'startDate and endDate are required'));
    if (!toISODate(startDate) || !toISODate(endDate)) return next(new HttpError(400, 'Invalid startDate or endDate'));
    const branchKey = branchKeyFromReq(req) || payload.branchId || payload.branchIdOrZoneId || payload.serviceZoneId || null;
    const job = glResetJobs.startGlResetJob({ startDate, endDate, branchId: branchKey, dryRun: payload.dryRun, includeOrders: asBool(payload.includeOrders, false) }, req.user || {});
    return res.status(202).json({ ok: true, job });
  } catch (e) {
    logger.error('[GL] start reset job error', e);
    return next(new HttpError(500, e.message || 'Failed to start GL reset job'));
  }
};

const getGlResetJob = async (req, res, next) => {
  try {
    const job = glResetJobs.getGlResetJob(req.params.jobId);
    if (!job) return next(new HttpError(404, 'GL reset job not found. The server may have restarted or the job id is invalid.'));
    return res.json({ ok: true, job });
  } catch (e) {
    return next(new HttpError(500, e.message || 'Failed to fetch GL reset job'));
  }
};

const listGlResetJobs = async (req, res, next) => {
  try {
    return res.json({ ok: true, jobs: glResetJobs.listGlResetJobs() });
  } catch (e) {
    return next(new HttpError(500, e.message || 'Failed to fetch GL reset jobs'));
  }
};

const verifyGlReset = async (req, res, next) => {
  try {
    const payload = { ...(req.query || {}), ...(req.body || {}) };
    const startDate = payload.startDate;
    const endDate = payload.endDate;
    if (!startDate || !endDate) return next(new HttpError(400, 'startDate and endDate are required'));
    if (!toISODate(startDate) || !toISODate(endDate)) return next(new HttpError(400, 'Invalid startDate or endDate'));
    const branchKey = branchKeyFromReq(req) || payload.branchId || payload.branchIdOrZoneId || payload.serviceZoneId || null;
    const startIncl = typeof glResetJobs.startOfDay === 'function' ? glResetJobs.startOfDay(startDate) : new Date(startDate);
    const endIncl = typeof glResetJobs.endOfDay === 'function' ? glResetJobs.endOfDay(endDate) : new Date(endDate);
    const verification = await glResetJobs.verifyResetState({ startIncl, endIncl, branchKey, includeOrders: asBool(payload.includeOrders, false) });
    return res.json({ ok: Boolean(verification.ok), verification });
  } catch (e) {
    logger.error('[GL] verify reset error', e);
    return next(new HttpError(500, e.message || 'Failed to verify GL reset'));
  }
};

const postApprovedForDate = async (req, res, next) => {
  try {
    const date = req.query.date || req.query.businessDate || req.body?.date || req.body?.businessDate;
    const branchKey = branchKeyFromReq(req);
    if (!date) return next(new HttpError(400, 'date or businessDate is required (YYYY-MM-DD)'));
    if (typeof postApproved !== 'function') return next(new HttpError(501, 'post-approved is not available'));
    const d = toISODate(date);
    if (!d) return next(new HttpError(400, 'Invalid date. Use YYYY-MM-DD'));

    const result = await postApproved({ date, businessDate: date, branchId: branchKey, includeOrders: asBool(req.query?.includeOrders ?? req.body?.includeOrders, false) });
    return res.json({ ok: true, date: d.toISOString().slice(0, 10), branchId: branchKey, ...result });
  } catch (e) {
    logger.error('[GL] post-approved error', e);
    return next(new HttpError(500, e.message || 'Failed to post approved documents'));
  }
};

const retryFailedPostings = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const branchKey = branchKeyFromReq(req);
    if (!startDate || !endDate) return next(new HttpError(400, 'startDate and endDate are required'));
    if (typeof retryFailed !== 'function') return next(new HttpError(501, 'retry-failed is not available'));
    if (!toISODate(startDate) || !toISODate(endDate)) return next(new HttpError(400, 'Invalid startDate or endDate'));

    const result = await retryFailed({ startDate, endDate, branchId: branchKey, includeOrders: asBool(req.query?.includeOrders ?? req.body?.includeOrders, false) });
    return res.json({ ok: true, startDate, endDate, branchId: branchKey, ...result });
  } catch (e) {
    logger.error('[GL] retry-failed error', e);
    return next(new HttpError(500, e.message || 'Failed to retry failed postings'));
  }
};

const getPostingExceptions = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const branchKey = branchKeyFromReq(req);
    if (!startDate || !endDate) return next(new HttpError(400, 'startDate and endDate are required'));
    if (typeof postingExceptions !== 'function') return next(new HttpError(501, 'posting-exceptions is not available'));
    if (!toISODate(startDate) || !toISODate(endDate)) return next(new HttpError(400, 'Invalid startDate or endDate'));

    const result = await postingExceptions({ startDate, endDate, branchId: branchKey, includeOrders: asBool(req.query?.includeOrders, false) });
    return res.json({ ok: true, startDate, endDate, branchId: branchKey, ...result });
  } catch (e) {
    logger.error('[GL] posting-exceptions error', e);
    return next(new HttpError(500, e.message || 'Failed to fetch posting exceptions'));
  }
};

const getTrialBalance = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const branchKey = branchKeyFromReq(req);
    if (startDate && endDate) {
      if (typeof trialBalanceService !== 'function') return next(new HttpError(501, 'trial-balance is not available'));
      const tb = await trialBalanceService({ startDate, endDate, branchId: branchKey });
      return res.json({
        period: { start: toISODate(startDate), end: endOfDay(endDate) },
        branch: { branchId: branchKey || null },
        totals: {
          debit: safeNum(tb?.totals?.debit, 0),
          credit: safeNum(tb?.totals?.credit, 0),
          balanced: Boolean(tb?.ok),
          diff: safeNum(tb?.diff, 0),
        },
        rows: (tb?.rows || []).map((r) => ({
          accountCode: String(r.accountCode),
          name: r.accountName || r.name || 'Unknown',
          type: r.accountType || r.type || 'UNKNOWN',
          normalBalance: r.normalBalance || null,
          debit: safeNum(r.debit, 0),
          credit: safeNum(r.credit, 0),
          balance: safeNum(r.balance, 0),
        })),
      });
    }

    const start = startDate ? startOfDay(startDate) : new Date('2000-01-01');
    const end = endDate ? endOfDay(endDate) : endOfDay(new Date());
    const match = { status: 'POSTED', date: { $gte: start, $lte: end } };
    if (branchKey) match.branchKey = String(branchKey);

    const rows = await GeneralLedgerEntry.aggregate([
      { $match: match },
      { $unwind: '$lines' },
      { $group: { _id: '$lines.accountCode', debit: { $sum: '$lines.debit' }, credit: { $sum: '$lines.credit' } } },
      { $sort: { _id: 1 } },
    ]);
    const coa = await ChartOfAccount.find({ isActive: true }).lean();
    const coaMap = new Map(coa.map((a) => [String(a.accountCode), a]));
    const shaped = rows.map((r) => {
      const meta = coaMap.get(String(r._id)) || null;
      const debit = safeNum(r.debit, 0);
      const credit = safeNum(r.credit, 0);
      const balance = meta?.normalBalance === 'CREDIT' ? credit - debit : debit - credit;
      return { accountCode: String(r._id), name: meta?.name || 'Unknown', type: meta?.type || 'UNKNOWN', normalBalance: meta?.normalBalance || null, debit, credit, balance };
    });
    const totalDebit = shaped.reduce((s, x) => s + safeNum(x.debit, 0), 0);
    const totalCredit = shaped.reduce((s, x) => s + safeNum(x.credit, 0), 0);
    return res.json({ period: { start, end }, branch: { branchId: branchKey || null }, totals: { debit: totalDebit, credit: totalCredit, balanced: Math.abs(totalDebit - totalCredit) <= 0.5, diff: Math.abs(totalDebit - totalCredit) }, rows: shaped });
  } catch (e) {
    logger.error('[GL] trial balance error', e);
    return next(new HttpError(500, e.message || 'Failed to compute trial balance'));
  }
};

const getHealth = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const branchKey = branchKeyFromReq(req);

    const dateMatch = {};
    if (startDate) dateMatch.$gte = startOfDay(startDate);
    if (endDate) dateMatch.$lte = endOfDay(endDate);
    const hasDateScope = Object.keys(dateMatch).length > 0;

    const glMatch = hasDateScope ? { date: dateMatch } : {};
    if (branchKey) glMatch.branchKey = String(branchKey);

    // Source-document filters. Posting failures are stored on the source documents,
    // not as FAILED GeneralLedgerEntry rows. GL Health must therefore inspect
    // DailySummary, ExpenseTransaction, StockIn and Order posting metadata directly.
    const dailyBase = mergeAnd(dailyBranchFilter(branchKey), byDateRange('date', dateMatch));
    const expenseBase = mergeAnd(stringBranchFilter(branchKey), byDateRange('date', dateMatch));
    const stockBase = mergeAnd(stringBranchFilter(branchKey), byDateRange('purchaseDate', dateMatch));
    const orderBase = mergeAnd(orderBranchFilter(branchKey), orderDateRangeFilter(dateMatch));

    const failedStatus = { 'posting.status': 'FAILED' };
    const postedStatus = { 'posting.status': 'POSTED' };

    const approvedDaily = { status: 'approved' };
    const approvedExpense = { status: { $in: ['approved', 'Approved', 'APPROVED'] } };
    const deliveredOrder = { status: 'Delivered' };

    const [
      coaCount,
      postedJournalCount,
      lastPosted,
      failedDailyCount,
      failedExpenseCount,
      failedStockCount,
      failedOrderCount,
      approvedSummaries,
      approvedExpenses,
      eligibleStockIns,
      deliveredOrders,
      postedSummaries,
      postedExpenses,
      postedStockIns,
      postedOrders,
    ] = await Promise.all([
      ChartOfAccount.countDocuments({ isActive: true }),
      GeneralLedgerEntry.countDocuments({ ...glMatch, status: 'POSTED' }),
      GeneralLedgerEntry.findOne({ ...glMatch, status: 'POSTED' }).sort({ createdAt: -1 }).select('createdAt date').lean(),

      DailySummary.countDocuments(mergeAnd(dailyBase, failedStatus)),
      ExpenseTransaction.countDocuments(mergeAnd(expenseBase, failedStatus)),
      StockIn.countDocuments(mergeAnd(stockBase, failedStatus)),
      Order.countDocuments(mergeAnd(orderBase, failedStatus)),

      DailySummary.countDocuments(mergeAnd(dailyBase, approvedDaily)),
      ExpenseTransaction.countDocuments(mergeAnd(expenseBase, approvedExpense)),
      StockIn.countDocuments(stockBase),
      Order.countDocuments(mergeAnd(orderBase, deliveredOrder)),

      DailySummary.countDocuments(mergeAnd(dailyBase, approvedDaily, postedStatus)),
      ExpenseTransaction.countDocuments(mergeAnd(expenseBase, approvedExpense, postedStatus)),
      StockIn.countDocuments(mergeAnd(stockBase, postedStatus)),
      Order.countDocuments(mergeAnd(orderBase, deliveredOrder, postedStatus)),
    ]);

    const failedPostingCount = failedDailyCount + failedExpenseCount + failedStockCount + failedOrderCount;

    const eligibleSourceCount = approvedSummaries + approvedExpenses + eligibleStockIns + deliveredOrders;
    const postedEligibleSourceCount = postedSummaries + postedExpenses + postedStockIns + postedOrders;
    const unpostedApprovedCount = Math.max(0, eligibleSourceCount - postedEligibleSourceCount);

    let tb = null;
    if (startDate && endDate && typeof trialBalanceService === 'function') {
      tb = await trialBalanceService({ startDate, endDate, branchId: branchKey });
    }

    const sourcePostingCounts = {
      failed: {
        dailySummaries: failedDailyCount,
        expenses: failedExpenseCount,
        stockIns: failedStockCount,
        orders: failedOrderCount,
        total: failedPostingCount,
      },
      eligible: {
        dailySummaries: approvedSummaries,
        expenses: approvedExpenses,
        stockIns: eligibleStockIns,
        orders: deliveredOrders,
        total: eligibleSourceCount,
      },
      posted: {
        dailySummaries: postedSummaries,
        expenses: postedExpenses,
        stockIns: postedStockIns,
        orders: postedOrders,
        total: postedEligibleSourceCount,
      },
    };

    const warnings = [];
    if (coaCount === 0) warnings.push('Chart of Accounts has not been bootstrapped.');
    if (failedPostingCount > 0) warnings.push('Some source documents have failed GL posting status. Open Posting Exceptions and retry after correcting the root cause.');
    if (unpostedApprovedCount > 0) warnings.push('Some eligible source documents are not yet posted.');
    if (tb && !tb.ok) warnings.push('Trial balance is not balanced for the selected period.');

    return res.json({
      ok: failedPostingCount === 0 && (tb ? Boolean(tb.ok) : true),
      coaCount,
      postedJournalCount,
      failedPostingCount,
      unpostedApprovedCount,
      trialBalanceBalanced: tb ? Boolean(tb.ok) : null,
      trialBalanceDiff: tb ? safeNum(tb.diff, 0) : null,
      lastPostedAt: lastPosted?.createdAt || null,
      sourcePostingCounts,
      warnings,
    });
  } catch (e) {
    logger.error('[GL] health error', e);
    return next(new HttpError(500, e.message || 'Failed to compute GL health'));
  }
};

const listJournals = async (req, res, next) => {
  try {
    const { startDate, endDate, branchId, serviceZoneId, sourceType, sourceId, status, batchId, page = 1, limit = 50 } = req.query;
    const query = {};
    if (startDate || endDate) query.date = {};
    if (startDate) query.date.$gte = startOfDay(startDate);
    if (endDate) query.date.$lte = endOfDay(endDate);
    const branchKey = branchId || serviceZoneId;
    if (branchKey) query.branchKey = String(branchKey);
    if (sourceType) query.sourceType = String(sourceType).toUpperCase();
    if (sourceId) query.sourceId = String(sourceId);
    if (status) query.status = String(status).toUpperCase();
    if (batchId) query['meta.postingBatchId'] = String(batchId);

    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const safePage = Math.max(Number(page) || 1, 1);
    const [items, total] = await Promise.all([
      GeneralLedgerEntry.find(query).sort({ date: -1, createdAt: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).lean(),
      GeneralLedgerEntry.countDocuments(query),
    ]);
    return res.json({ ok: true, page: safePage, limit: safeLimit, total, items });
  } catch (e) {
    logger.error('[GL] list journals error', e);
    return next(new HttpError(500, e.message || 'Failed to fetch GL journals'));
  }
};


const getReadiness = async (req, res, next) => {
  try {
    const payload = await buildReadinessPayload(req);
    return res.json({ ok: true, ...payload });
  } catch (e) {
    logger.error('[GL] readiness error', e);
    return next(new HttpError(500, e.message || 'Failed to compute GL readiness'));
  }
};

const runSafeSetup = async (req, res, next) => {
  try {
    if (typeof bootstrap !== 'function') return next(new HttpError(501, 'GL bootstrap is not available'));
    const bootstrapResult = await bootstrap();

    // Re-read readiness after bootstrap so the UI can immediately reflect the safer state.
    const payload = await buildReadinessPayload(req);
    return res.json({
      ok: true,
      message: 'Safe setup completed. GL bootstrap has been executed; business-specific setup items still require review if flagged.',
      bootstrap: bootstrapResult,
      readiness: payload,
    });
  } catch (e) {
    logger.error('[GL] run safe setup error', e);
    return next(new HttpError(500, e.message || 'Failed to run GL safe setup'));
  }
};

const reverseJournal = async (req, res, next) => {
  try {
    const glEntryId = req.body?.glEntryId || req.body?.journalId || req.query.glEntryId;
    if (!glEntryId) return next(new HttpError(400, 'glEntryId is required'));
    const reason = req.body?.reason || req.body?.narration || '';
    if (!String(reason || '').trim()) return next(new HttpError(400, 'Reversal reason is required'));
    if (typeof postReversal !== 'function') return next(new HttpError(501, 'GL reversal is not available'));
    if (typeof assertPeriodOpenForDate === 'function') await assertPeriodOpenForDate(req.body?.reversalDate || req.body?.date || new Date(), 'reverse GL journal');
    const result = await postReversal({ glEntryId }, {
      reversalDate: req.body?.reversalDate || req.body?.date,
      reason,
      reversedBy: req.user?.id || req.user?._id || req.user?.email || 'system',
      unpostSource: req.body?.unpostSource !== undefined ? Boolean(req.body.unpostSource) : true,
    });
    return res.json({ ok: true, ...result });
  } catch (e) {
    logger.error('[GL] reverse journal error', e);
    return next(new HttpError(e.code === 'NOT_FOUND' ? 404 : (e.code === 'PERIOD_LOCKED' ? 400 : 500), e.message || 'Failed to reverse GL journal'));
  }
};

const listPostingBatches = async (req, res, next) => {
  try {
    const result = await listPostingBatchesService({
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      branchId: branchKeyFromReq(req),
      action: req.query.action,
      page: req.query.page,
      limit: req.query.limit,
    });
    return res.json(result);
  } catch (e) {
    logger.error('[GL] list posting batches error', e);
    return next(new HttpError(500, e.message || 'Failed to fetch posting batches'));
  }
};

const listPeriods = async (req, res, next) => {
  try {
    const { startPeriod, endPeriod } = req.query || {};
    const query = {};
    if (startPeriod || endPeriod) {
      query.periodKey = {};
      if (startPeriod) query.periodKey.$gte = String(startPeriod);
      if (endPeriod) query.periodKey.$lte = String(endPeriod);
    }
    const items = await AccountingPeriod.find(query).sort({ periodKey: -1 }).lean();
    return res.json({ ok: true, items });
  } catch (e) {
    return next(new HttpError(500, e.message || 'Failed to fetch accounting periods'));
  }
};

const lockPeriod = async (req, res, next) => {
  try {
    const periodKey = String(req.body?.periodKey || req.query.periodKey || '').slice(0, 7);
    const reason = req.body?.reason || req.query.reason || '';
    if (!/^\d{4}-\d{2}$/.test(periodKey)) return next(new HttpError(400, 'periodKey is required in YYYY-MM format'));
    if (!String(reason || '').trim()) return next(new HttpError(400, 'Lock reason is required'));
    const updated = await AccountingPeriod.findOneAndUpdate(
      { periodKey },
      { $set: { status: 'LOCKED', lockedAt: new Date(), lockedBy: req.user?.id || req.user?._id || req.user?.email || 'system', lockReason: reason } },
      { upsert: true, new: true }
    ).lean();
    return res.json({ ok: true, period: updated });
  } catch (e) {
    return next(new HttpError(500, e.message || 'Failed to lock period'));
  }
};

const reopenPeriod = async (req, res, next) => {
  try {
    const periodKey = String(req.body?.periodKey || req.query.periodKey || '').slice(0, 7);
    const reason = req.body?.reason || req.query.reason || '';
    if (!/^\d{4}-\d{2}$/.test(periodKey)) return next(new HttpError(400, 'periodKey is required in YYYY-MM format'));
    if (!String(reason || '').trim()) return next(new HttpError(400, 'Reopen reason is required'));
    const updated = await AccountingPeriod.findOneAndUpdate(
      { periodKey },
      { $set: { status: 'OPEN', reopenedAt: new Date(), reopenedBy: req.user?.id || req.user?._id || req.user?.email || 'system', reopenReason: reason } },
      { upsert: true, new: true }
    ).lean();
    return res.json({ ok: true, period: updated });
  } catch (e) {
    return next(new HttpError(500, e.message || 'Failed to reopen period'));
  }
};



const requestReversal = async (req, res, next) => {
  try {
    const journalId = req.body?.journalId || req.body?.glEntryId;
    const reason = req.body?.reason;
    if (!journalId || !mongoose.Types.ObjectId.isValid(String(journalId))) return next(new HttpError(400, 'Valid journalId/glEntryId is required'));
    if (!String(reason || '').trim()) return next(new HttpError(400, 'Reversal request reason is required'));
    const journal = await GeneralLedgerEntry.findById(journalId).lean();
    if (!journal) return next(new HttpError(404, 'GL journal not found'));
    if (journal.status !== 'POSTED') return next(new HttpError(400, 'Only POSTED journals can be submitted for reversal'));
    const request = await GLReversalRequest.create({
      journalId,
      reason,
      requestedBy: req.user?.id || req.user?._id || req.user?.email || 'system',
      meta: { sourceType: journal.sourceType, sourceId: journal.sourceId, date: journal.date, branchKey: journal.branchKey },
    });
    return res.status(201).json({ ok: true, request });
  } catch (e) { return next(new HttpError(500, e.message || 'Failed to request GL reversal')); }
};

const listReversalRequests = async (req, res, next) => {
  try {
    const q = {};
    if (req.query.status) q.status = String(req.query.status).toUpperCase();
    const items = await GLReversalRequest.find(q).populate('journalId').sort({ createdAt: -1 }).limit(Math.min(Number(req.query.limit) || 100, 500)).lean();
    return res.json({ ok: true, items });
  } catch (e) { return next(new HttpError(500, e.message || 'Failed to list GL reversal requests')); }
};

const approveReversalRequest = async (req, res, next) => {
  try {
    const requestId = req.params.requestId || req.body?.requestId;
    const comment = req.body?.comment || req.body?.reviewComment || null;
    if (!requestId || !mongoose.Types.ObjectId.isValid(String(requestId))) return next(new HttpError(400, 'Valid reversal requestId is required'));
    const reqDoc = await GLReversalRequest.findById(requestId);
    if (!reqDoc) return next(new HttpError(404, 'Reversal request not found'));
    if (reqDoc.status !== 'PENDING') return next(new HttpError(400, 'Only pending reversal requests can be approved'));
    if (String(reqDoc.requestedBy) === String(req.user?.id || req.user?._id || req.user?.email || 'system')) return next(new HttpError(400, 'Maker-checker control failed: requester cannot approve the reversal.'));
    const journal = await GeneralLedgerEntry.findById(reqDoc.journalId).lean();
    if (!journal) return next(new HttpError(404, 'GL journal not found'));
    if (typeof assertPeriodOpenForDate === 'function') await assertPeriodOpenForDate(journal.date, 'approve GL reversal');
    if (typeof postReversal !== 'function') return next(new HttpError(501, 'GL reversal is not available'));
    const result = await postReversal({ glEntryId: reqDoc.journalId }, {
      reversalDate: req.body?.reversalDate || new Date(),
      reason: reqDoc.reason,
      reversedBy: req.user?.id || req.user?._id || req.user?.email || 'system',
      unpostSource: req.body?.unpostSource !== undefined ? Boolean(req.body.unpostSource) : true,
    });
    reqDoc.status = 'EXECUTED';
    reqDoc.reviewedBy = req.user?.id || req.user?._id || req.user?.email || 'system';
    reqDoc.reviewedAt = new Date();
    reqDoc.reviewComment = comment;
    reqDoc.executedAt = new Date();
    reqDoc.reversalEntryId = result.reversalEntryId || (Array.isArray(result.glEntryIds) ? result.glEntryIds[0] : null);
    await reqDoc.save();
    return res.json({ ok: true, request: reqDoc, reversal: result });
  } catch (e) { return next(new HttpError(e.code === 'PERIOD_LOCKED' ? 400 : 500, e.message || 'Failed to approve reversal request')); }
};

const rejectReversalRequest = async (req, res, next) => {
  try {
    const requestId = req.params.requestId || req.body?.requestId;
    const comment = req.body?.comment || req.body?.reviewComment || req.body?.reason;
    if (!requestId || !mongoose.Types.ObjectId.isValid(String(requestId))) return next(new HttpError(400, 'Valid reversal requestId is required'));
    if (!String(comment || '').trim()) return next(new HttpError(400, 'Rejection comment is required'));
    const updated = await GLReversalRequest.findByIdAndUpdate(requestId, { $set: { status: 'REJECTED', reviewedBy: req.user?.id || req.user?._id || req.user?.email || 'system', reviewedAt: new Date(), reviewComment: comment } }, { new: true });
    if (!updated) return next(new HttpError(404, 'Reversal request not found'));
    return res.json({ ok: true, request: updated });
  } catch (e) { return next(new HttpError(500, e.message || 'Failed to reject reversal request')); }
};

const generateFiscalPeriods = async (req, res, next) => {
  try {
    const year = Number(req.body?.year || req.query?.year || new Date().getUTCFullYear());
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return next(new HttpError(400, 'Valid year is required'));
    const rows = [];
    for (let m = 1; m <= 12; m += 1) {
      const periodKey = `${year}-${String(m).padStart(2, '0')}`;
      rows.push(await AccountingPeriod.findOneAndUpdate({ periodKey }, { $setOnInsert: { periodKey, status: 'OPEN' } }, { upsert: true, new: true, setDefaultsOnInsert: true }).lean());
    }
    return res.status(201).json({ ok: true, year, items: rows });
  } catch (e) { return next(new HttpError(500, e.message || 'Failed to generate fiscal periods')); }
};


const approveSourceDiscrepancy = async (req, res, next) => {
  try {
    const sourceType = String(req.body?.sourceType || req.params?.sourceType || '').toUpperCase();
    const sourceId = req.body?.sourceId || req.params?.sourceId;
    const reason = String(req.body?.reason || req.body?.approvalReason || '').trim();
    if (!sourceType || !sourceId) return next(new HttpError(400, 'sourceType and sourceId are required.'));
    if (!reason) return next(new HttpError(400, 'Approval reason is required.'));

    if (sourceType !== 'DAILY_SUMMARY') {
      return next(new HttpError(400, 'Only DAILY_SUMMARY discrepancy approval is currently supported.'));
    }

    let summary = null;
    if (mongoose.Types.ObjectId.isValid(String(sourceId))) summary = await DailySummary.findById(sourceId);
    if (!summary) summary = await DailySummary.findOne({ dailySummaryId: String(sourceId) });
    if (!summary) return next(new HttpError(404, 'Daily summary source record was not found.'));

    const revenue = safeNum(summary?.sales?.totalRevenue, 0);
    const tenderTotal = safeNum(summary?.sales?.cashAmount, 0) + safeNum(summary?.sales?.posAmount, 0) + safeNum(summary?.sales?.transferAmount, 0);
    const difference = revenue - tenderTotal;

    summary.finalizationControls = {
      ...(summary.finalizationControls || {}),
      reconciliationReviewed: true,
      varianceAcknowledged: true,
      varianceReason: reason,
    };
    summary.managerApproval = {
      ...(summary.managerApproval || {}),
      policyOverrideReason: reason,
    };
    summary.posting = {
      ...(summary.posting || {}),
      // Leave FAILED rows failed so Retry Failed can pick them up immediately.
      status: summary?.posting?.status || 'UNPOSTED',
      tenderVarianceApproved: true,
      tenderVarianceApprovedAt: new Date(),
      tenderVarianceApprovedBy: req.user?.id || req.user?._id || req.user?.email || 'system',
      errorMessage: summary?.posting?.errorMessage || null,
      errorCode: summary?.posting?.errorCode || null,
    };
    await summary.save();

    return res.json({
      ok: true,
      message: 'Daily summary discrepancy approved. Retry Failed or Rebuild GL for the period to post the difference to Cash Over/Short.',
      sourceType,
      sourceId: String(summary._id),
      dailySummaryId: summary.dailySummaryId,
      revenue,
      tenderTotal,
      difference,
      postingStatus: summary.posting?.status || 'UNPOSTED',
    });
  } catch (e) {
    logger.error('[GL] approve discrepancy error', e);
    return next(new HttpError(500, e.message || 'Failed to approve source discrepancy'));
  }
};


const listApprovedUnpostedSources = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const branchKey = branchKeyFromReq(req);
    const status = String(req.query.status || 'ALL').toUpperCase();
    const includeOrders = asBool(req.query.includeOrders, false);
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    if (!startDate || !endDate) return next(new HttpError(400, 'startDate and endDate are required'));
    const start = startOfDay(startDate);
    const end = endOfDay(endDate);
    const filters = await buildSourceBranchFilters(branchKey);
    const statusFilter = status === 'ALL'
      ? { $in: ['UNPOSTED', 'QUEUED', 'FAILED', null] }
      : status;
    const matchPosting = status === 'ALL'
      ? { $or: [{ 'posting.status': { $in: ['UNPOSTED', 'QUEUED', 'FAILED'] } }, { 'posting.status': { $exists: false } }] }
      : { 'posting.status': statusFilter };

    const [stockIns, dailies, expenses] = await Promise.all([
      StockIn.find({ ...(branchKey ? filters.stock : {}), purchaseDate: { $gte: start, $lte: end }, ...matchPosting })
        .select('_id id purchaseDate branchId stockType supplier quantityKg amountPaid paidAmount posting').lean(),
      DailySummary.find({ ...(branchKey ? filters.daily : {}), date: { $gte: start, $lte: end }, status: 'approved', ...matchPosting })
        .select('_id dailySummaryId date branchId cashierName sales posting').lean(),
      ExpenseTransaction.find({ ...(branchKey ? filters.expense : {}), date: { $gte: start, $lte: end }, status: { $in: ['approved', 'Approved', 'APPROVED'] }, ...matchPosting })
        .select('_id date branchId category description amount posting').lean(),
    ]);

    const orders = includeOrders
      ? await Order.find({ ...(branchKey ? filters.order : {}), $or: [{ orderDate: { $gte: start, $lte: end } }, { orderDate: { $exists: false }, createdAt: { $gte: start, $lte: end } }], ...matchPosting })
          .select('_id id orderDate createdAt branchId serviceZoneId zoneId plantId totalAmount posting').lean()
      : [];

    const normalize = (type, doc, date, amount, kg, desc) => ({
      sourceType: type,
      sourceId: String(doc._id),
      sourceRef: doc.dailySummaryId || doc.id || String(doc._id),
      date: date ? new Date(date).toISOString().slice(0, 10) : null,
      branchKey: doc.branchId ? String(doc.branchId) : (doc.serviceZoneId || doc.zoneId || doc.plantId || null),
      description: desc,
      amount: safeNum(amount, 0),
      kg: safeNum(kg, 0),
      postingStatus: doc?.posting?.status || 'UNPOSTED',
      attempts: safeNum(doc?.posting?.attempts, 0),
      errorCode: doc?.posting?.errorCode || null,
      errorMessage: doc?.posting?.errorMessage || null,
      recommendation: doc?.posting?.status === 'FAILED'
        ? 'Open GL Health to view the detailed reason. Correct the source/setup issue, then use Retry Failed for this period.'
        : 'Ready for GL rebuild or post-approved action.',
    });

    const items = [
      ...stockIns.map((x) => normalize('STOCK_IN', x, x.purchaseDate, x.amountPaid || x.paidAmount, x.quantityKg, `${x.stockType || 'Stock-In'} - ${x.supplier || ''}`)),
      ...dailies.map((x) => normalize('DAILY_SUMMARY', x, x.date, x.sales?.totalRevenue, x.sales?.totalKgSold, `Daily close - ${x.cashierName || 'cashier'}`)),
      ...orders.map((x) => normalize('ORDER', x, x.orderDate || x.createdAt, x.totalAmount, 0, 'Delivered order')),
      ...expenses.map((x) => normalize('EXPENSE', x, x.date, x.amount, 0, `${x.category || 'Expense'} - ${x.description || ''}`)),
    ].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || a.sourceType.localeCompare(b.sourceType));

    const total = items.length;
    const paged = items.slice((page - 1) * limit, page * limit);
    return res.json({ ok: true, startDate, endDate, branchId: branchKey || null, page, limit, glOrderScope: glOrderScopeMeta(includeOrders), total, items: paged, counts: { total, unposted: items.filter((x) => x.postingStatus === 'UNPOSTED').length, queued: items.filter((x) => x.postingStatus === 'QUEUED').length, failed: items.filter((x) => x.postingStatus === 'FAILED').length } });
  } catch (e) {
    logger.error('[GL] approved-unposted error', e);
    return next(new HttpError(500, e.message || 'Failed to load approved/unposted source records'));
  }
};

const exportJournals = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const branchKey = branchKeyFromReq(req);
    const query = {};
    if (startDate || endDate) query.date = {};
    if (startDate) query.date.$gte = startOfDay(startDate);
    if (endDate) query.date.$lte = endOfDay(endDate);
    if (branchKey) query.branchKey = String(branchKey);
    const journals = await GeneralLedgerEntry.find(query).sort({ date: 1, createdAt: 1 }).lean();
    const header = ['Date','Period','JournalId','SourceType','SourceId','EntryType','Branch','Narration','AccountCode','Debit','Credit','Status'];
    const esc = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const lines = [header.map(esc).join(',')];
    journals.forEach((j) => (j.lines || []).forEach((l) => {
      lines.push([j.date ? new Date(j.date).toISOString().slice(0,10) : '', j.periodKey, j._id, j.sourceType, j.sourceId, j.entryType, j.branchKey, j.narration, l.accountCode, l.debit || 0, l.credit || 0, j.status].map(esc).join(','));
    }));
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="gl_journals_${Date.now()}.csv"`);
    return res.send(lines.join('\n'));
  } catch (e) { return next(new HttpError(500, e.message || 'Failed to export journals')); }
};

const getFinanceConfidence = async (req, res, next) => {
  try {
    const branchKey = branchKeyFromReq(req);
    const startDate = req.query?.startDate || req.query?.date || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
    const endDate = req.query?.endDate || new Date().toISOString().slice(0, 10);
    const dateMatch = { $gte: startOfDay(startDate), $lte: endOfDay(endDate) };
    const dailyBase = mergeAnd(dailyBranchFilter(branchKey), byDateRange('date', dateMatch));
    const stringBase = mergeAnd(stringBranchFilter(branchKey), byDateRange('date', dateMatch));

    const [tb, unfinalizedDays, approvedUnpostedDays, failedPostings, stockCount, priceCount, mappingCount, lockedPeriods, reconIssues] = await Promise.all([
      trialBalanceService({ startDate, endDate, branchId: branchKey }).catch(() => null),
      DailySummary.countDocuments(mergeAnd(dailyBase, { status: { $in: ['in_progress', 'pending_approval', 'rejected'] } })),
      DailySummary.countDocuments(mergeAnd(dailyBase, { status: 'approved', 'posting.status': { $ne: 'POSTED' } })),
      DailySummary.countDocuments(mergeAnd(dailyBase, { 'posting.status': 'FAILED' })),
      StockIn.countDocuments(branchKey ? stringBranchFilter(branchKey) : {}),
      BranchPrice.countDocuments(branchKey ? { branchId: String(branchKey), status: 'ACTIVE' } : { status: 'ACTIVE' }),
      BranchStockConfig.countDocuments(branchKey ? { branchId: String(branchKey), isActive: true } : { isActive: true }),
      AccountingPeriod.countDocuments({ periodKey: { $gte: String(startDate).slice(0, 7), $lte: String(endDate).slice(0, 7) }, status: 'LOCKED' }),
      StockReconciliation.countDocuments(mergeAnd(branchKey ? stringBranchFilter(branchKey) : {}, byDateRange('businessDate', dateMatch), { status: { $ne: 'POSTED' }, varianceKg: { $ne: 0 } })).catch(() => 0),
    ]);

    const checks = [
      { key: 'trial_balance_balanced', passed: Boolean(tb?.balanced ?? tb?.isBalanced), weight: 25, message: 'Trial balance is balanced for the selected period.' },
      { key: 'no_unfinalized_days', passed: unfinalizedDays === 0, weight: 15, message: `${unfinalizedDays} unresolved daily close item(s).` },
      { key: 'all_approved_days_posted', passed: approvedUnpostedDays === 0, weight: 15, message: `${approvedUnpostedDays} approved but unposted daily summary item(s).` },
      { key: 'no_failed_postings', passed: failedPostings === 0, weight: 15, message: `${failedPostings} failed daily summary posting(s).` },
      { key: 'stock_available', passed: stockCount > 0, weight: 10, message: `${stockCount} stock batch(es) found.` },
      { key: 'branch_price_configured', passed: priceCount > 0, weight: 8, message: `${priceCount} active price row(s) found.` },
      { key: 'branch_stock_mapping', passed: mappingCount > 0, weight: 7, message: `${mappingCount} branch stock mapping row(s) found.` },
      { key: 'period_locked_or_ready', passed: lockedPeriods > 0, weight: 3, warning: lockedPeriods === 0, message: lockedPeriods > 0 ? 'Accounting period is locked.' : 'Accounting period is not locked yet.' },
      { key: 'stock_reconciliation_clean', passed: reconIssues === 0, weight: 2, message: `${reconIssues} unresolved stock reconciliation variance item(s).` },
    ];
    const maxScore = checks.reduce((s, c) => s + c.weight, 0);
    const score = Math.round((checks.filter((c) => c.passed).reduce((s, c) => s + c.weight, 0) / maxScore) * 100);
    const level = score >= 85 ? 'HIGH' : score >= 60 ? 'MEDIUM' : 'LOW';
    return res.json({ ok: true, level, score, period: { startDate, endDate }, branchId: branchKey || null, checks, counts: { unfinalizedDays, approvedUnpostedDays, failedPostings, stockCount, priceCount, mappingCount, lockedPeriods, reconIssues } });
  } catch (e) {
    logger.error('[GL] finance confidence error', e);
    return next(new HttpError(500, e.message || 'Failed to calculate finance confidence'));
  }
};

module.exports = {
  exportPostingBatch,
  getPostingBatchDetail,
  getJournalDetail,
  getHelpCatalog,
  getCOA,
  bootstrapCOA,
  rebuild,
  startGlRebuildJob,
  getGlRebuildJob,
  listGlRebuildJobs,
  startGlResetJob,
  getGlResetJob,
  listGlResetJobs,
  verifyGlReset,
  postApprovedForDate,
  retryFailedPostings,
  getPostingExceptions,
  approveSourceDiscrepancy,
  listApprovedUnpostedSources,
  getTrialBalance,
  getHealth,
  getReadiness,
  runSafeSetup,
  listJournals,
  reverseJournal,
  listPostingBatches,
  listPeriods,
  lockPeriod,
  reopenPeriod,
  generateFiscalPeriods,
  requestReversal,
  listReversalRequests,
  approveReversalRequest,
  rejectReversalRequest,
  exportJournals,
  getFinanceConfidence,
};
