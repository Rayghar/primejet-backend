// src/api/v2/financials/financials.controller.js

const { Parser } = require('json2csv');
const Order = require('../../../models/order.model');
const DailySummary = require('../../../models/dailySummary.model');
const ExpenseTransaction = require('../../../models/expenseTransaction.model');
const Asset = require('../../../models/asset.model');
const Loan = require('../../../models/loan.model');
const StockIn = require('../../../models/stockIn.model');
const StockMovement = require('../../../models/stockMovement.model');
const SaleTransaction = require('../../../models/saleTransaction.model');
const SettlementConfirmation = require('../../../models/settlementConfirmation.model');
const StatementUpload = require('../../../models/statementUpload.model');
const Plant = require('../../../models/plant.model');
const Config = require('../../../models/config.model');
const { logger } = require('../../../config/logger.config');
const HttpError = require('../../../utils/HttpError');
const mongoose = require('mongoose');
const { buildReportingPolicyMeta, normalizeSourceMode } = require('../../../utils/reportingPolicy');

// ✅ NEW (GL support): optional models (only if you added them)
let ChartOfAccount = null;
let GeneralLedgerEntry = null;
try {
  ChartOfAccount = require('../../../models/chartOfAccount.model');
  GeneralLedgerEntry = require('../../../models/generalLedgerEntry.model');
} catch (e) {
  ChartOfAccount = null;
  GeneralLedgerEntry = null;
}

// Optional wallet ledger model. Register explicitly when available so finance reports can
// review wallet liability without requiring payment-gateway integration.
let MigrationStagingRecord = null;
try {
  MigrationStagingRecord = require('../../../models/migrationStagingRecord.model');
} catch (e) {
  MigrationStagingRecord = mongoose.models?.MigrationStagingRecord || null;
}

let WalletTransaction = null;
try {
  WalletTransaction = require('../../../models/walletTransaction.model');
} catch (e) {
  WalletTransaction = mongoose.models?.WalletTransaction || null;
}

// -------------------------
// Tiny helpers
// -------------------------
const _safeNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};


const DEFAULT_FINANCE_SETTINGS = {
  companyIncomeTaxPercentage: 30,
  vatPercentage: 7.5,
  withholdingTaxPercentage: 0,
  applyCompanyIncomeTaxProvision: true,
  showDscrWhenNoDebt: false,
};

const getFinanceSettings = async () => {
  try {
    const cfg = await Config.findOne().select('financialSettings feeSettings').lean();
    const fs = cfg?.financialSettings || {};
    const fee = cfg?.feeSettings || {};
    return {
      companyIncomeTaxPercentage: _safeNum(fs.companyIncomeTaxPercentage, DEFAULT_FINANCE_SETTINGS.companyIncomeTaxPercentage),
      vatPercentage: _safeNum(fs.vatPercentage ?? fee.vatPercentage, DEFAULT_FINANCE_SETTINGS.vatPercentage),
      withholdingTaxPercentage: _safeNum(fs.withholdingTaxPercentage, DEFAULT_FINANCE_SETTINGS.withholdingTaxPercentage),
      applyCompanyIncomeTaxProvision: fs.applyCompanyIncomeTaxProvision !== undefined ? Boolean(fs.applyCompanyIncomeTaxProvision) : DEFAULT_FINANCE_SETTINGS.applyCompanyIncomeTaxProvision,
      showDscrWhenNoDebt: fs.showDscrWhenNoDebt !== undefined ? Boolean(fs.showDscrWhenNoDebt) : DEFAULT_FINANCE_SETTINGS.showDscrWhenNoDebt,
      source: cfg ? 'Config.financialSettings' : 'Default finance settings',
    };
  } catch (e) {
    return { ...DEFAULT_FINANCE_SETTINGS, source: 'Default finance settings - config unavailable' };
  }
};

const computeDscrMeta = ({ ebitda = 0, debtService = 0, showWhenNoDebt = false } = {}) => {
  const service = _safeNum(debtService, 0);
  const earnings = _safeNum(ebitda, 0);
  if (service <= 0) {
    return {
      dscr: showWhenNoDebt ? 0 : null,
      debtService: 0,
      status: 'not_applicable',
      label: 'N/A',
      explanation: 'DSCR is not applicable because no debt-service/loan repayment schedule was found for the selected period.',
    };
  }
  const value = earnings / service;
  return {
    dscr: value,
    debtService: service,
    status: value >= 1.25 ? 'healthy' : value >= 1 ? 'watch' : 'weak',
    label: `${value.toFixed(2)}x`,
    explanation: 'DSCR = EBITDA divided by scheduled debt service for the selected period.',
  };
};

const _asObjectId = (v) =>
  mongoose.Types.ObjectId.isValid(String(v)) ? new mongoose.Types.ObjectId(String(v)) : null;

const _endOfDay = (d) => {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
};

const _dateKey = (v) => {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10);
};

/**
 * IMPORTANT:
 * "branchId equals service zone id"
 *
 * Your DB can be mixed:
 *  - Some collections store branchId as ObjectId, some as string.
 *  - Some versions store serviceZoneId/zoneId/plantId.
 *
 * So we filter in a tolerant way:
 *  - match branchId as string OR ObjectId
 *  - OR match serviceZoneId/zoneId/plantId as string OR ObjectId
 */
const _splitBranchValues = (value) => {
  if (Array.isArray(value)) return value.flatMap(_splitBranchValues);
  if (value === undefined || value === null || String(value).trim() === '') return [];
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
};

const buildBranchOrZoneMatch = (branchIdOrZoneId) => {
  const values = [...new Set(_splitBranchValues(branchIdOrZoneId))];
  if (!values.length) return {};

  const ors = [];
  for (const s of values) {
    const oid = _asObjectId(s);
    ors.push({ branchId: s }, { serviceZoneId: s }, { zoneId: s }, { plantId: s }, { branchKey: s });
    if (oid) {
      ors.push({ branchId: oid }, { serviceZoneId: oid }, { zoneId: oid }, { plantId: oid });
    }
  }

  return { $or: ors };
};

/* legacy single-branch implementation retained in history by investor branch-scope fix */
const __legacyBuildBranchOrZoneMatch = (branchIdOrZoneId) => {
  if (!branchIdOrZoneId) return {};

  const s = String(branchIdOrZoneId);
  const oid = _asObjectId(s);

  const ors = [{ branchId: s }, { serviceZoneId: s }, { zoneId: s }, { plantId: s }];

  if (oid) {
    ors.push({ branchId: oid });
    ors.push({ serviceZoneId: oid });
    ors.push({ zoneId: oid });
    ors.push({ plantId: oid });
  }

  return { $or: ors };
};

/**
 * Helper: Calculate Date Range
 * - Ensures end is inclusive (end-of-day)
 */
const getDateRange = (period = 'monthly', customStart, customEnd) => {
  const now = new Date();
  let start = new Date(now.getFullYear(), 0, 1);
  let end = new Date();

  if (period === 'monthly') {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (period === 'quarterly') {
    const quarter = Math.floor(now.getMonth() / 3);
    start = new Date(now.getFullYear(), quarter * 3, 1);
  } else if (period === 'yearly') {
    start = new Date(now.getFullYear(), 0, 1);
  } else if (period === 'allTime' || period === 'allMigrated') {
    start = new Date('2025-06-01T00:00:00.000Z');
  } else if (period === 'custom' && customStart && customEnd) {
    start = new Date(customStart);
    end = new Date(customEnd);
  }

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    start = new Date(now.getFullYear(), 0, 1);
    end = new Date();
  }

  // ✅ inclusive end-of-day to avoid missing same-day records
  end.setHours(23, 59, 59, 999);

  return { start, end };
};

/**
 * Revenue recognition rule (Delivery Orders):
 * - Recognize revenue ONLY when paymentStatus indicates PAID
 * - Delivered but unpaid becomes receivable (NOT revenue)
 */
const _isPaid = (paymentStatus) => {
  const ps = String(paymentStatus || '').toLowerCase().trim();
  return ps === 'completed' || ps === 'paid' || ps === 'success' || ps === 'successful';
};

/**
 * Keep deliveries-only intent:
 * - exclude cancelled
 * - optionally enforce channel if it exists
 */
const _ordersDeliveryGuard = () => ({
  status: { $ne: 'Canceled by Customer' },
  $or: [{ channel: { $exists: false } }, { channel: 'DELIVERY' }],
});


const REPORTING_SCOPES = Object.freeze({
  POS_ONLY: 'migrated_pos_only',
  DELIVERY_ONLY: 'app_delivery_only',
  COMBINED: 'combined_business',
});

const normalizeReportingScope = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return REPORTING_SCOPES.POS_ONLY;
  if (['pos', 'pos_only', 'pos-only', 'migration', 'migrated', 'migrated_pos', 'migrated-pos', 'migrated_pos_only', 'migrated-pos-only', 'daily_summary', 'daily-summary'].includes(raw)) return REPORTING_SCOPES.POS_ONLY;
  if (['delivery', 'delivery_only', 'delivery-only', 'app_delivery', 'app-delivery', 'app_delivery_only', 'app-delivery-only', 'orders', 'orders_only', 'order_only'].includes(raw)) return REPORTING_SCOPES.DELIVERY_ONLY;
  if (['combined', 'combined_business', 'combined-business', 'all', 'business', 'full_business', 'full-business'].includes(raw)) return REPORTING_SCOPES.COMBINED;
  return REPORTING_SCOPES.POS_ONLY;
};

const scopeIncludesPOS = (scope) => scope === REPORTING_SCOPES.POS_ONLY || scope === REPORTING_SCOPES.COMBINED;
const scopeIncludesDelivery = (scope) => scope === REPORTING_SCOPES.DELIVERY_ONLY || scope === REPORTING_SCOPES.COMBINED;

const reportingScopeLabel = (scope) => {
  if (scope === REPORTING_SCOPES.DELIVERY_ONLY) return 'App delivery orders only';
  if (scope === REPORTING_SCOPES.COMBINED) return 'Combined business view (DailySummary POS + standalone app delivery orders)';
  return 'Migrated POS / DailySummary only';
};

/**
 * Helper: Sum delivery orders
 * - recognizedRevenue: paid deliveries only
 * - invoicedRevenue: all delivered in period (paid+unpaid)
 * - unpaidDelivered: delivered but unpaid (for reconciliation/receivables)
 * - kgSold: quantity sum (if you store kg as quantity)
 */
const calcDeliverySales = (orders = []) => {
  let recognizedRevenue = 0;
  let invoicedRevenue = 0;
  let unpaidDelivered = 0;
  let kgSold = 0;

  for (const o of orders) {
    const amt = _safeNum(o.grandTotal, 0);
    invoicedRevenue += amt;

    if (_isPaid(o.paymentStatus)) recognizedRevenue += amt;
    else unpaidDelivered += amt;

    const items = Array.isArray(o.items) ? o.items : [];
    const itemKg = items.reduce((s, it) => s + _safeNum(it.quantity, 0), 0);
    if (itemKg > 0) kgSold += itemKg;
  }

  return { recognizedRevenue, invoicedRevenue, unpaidDelivered, kgSold };
};

/**
 * Helper: Sum POS revenue + kg from DailySummary (POS = DailySummary)
 *
 * ✅ CRITICAL: POS is filtered ONLY by business date field (DailySummary.date)
 *    We do NOT use createdAt for date filtering (per your instruction).
 */
const calcPosSales = (summaries = []) => {
  let revenue = 0;
  let kgSold = 0;

  for (const s of summaries) {
    revenue += _safeNum(s?.sales?.totalRevenue, 0);
    kgSold += _safeNum(s?.sales?.totalKgSold, 0);
  }

  return { revenue, kgSold };
};

/**
 * Helper: Inventory valuation from StockIn remainingKg * costPerKg (real-time)
 */
const calcInventoryValuation = (stockIns = []) => {
  let totalRemainingKg = 0;
  let totalValue = 0;

  for (const b of stockIns) {
    const rem = _safeNum(b.remainingKg, 0);
    const cpk = _safeNum(b.costPerKg, 0);
    totalRemainingKg += rem;
    totalValue += rem * cpk;
  }

  return { totalRemainingKg, totalValue };
};

/**
 * Helper: Weighted average cost per kg from StockIn batches up to end date
 */
const calcWeightedAvgCostPerKg = (stockIns = []) => {
  let totalKg = 0;
  let totalCost = 0;

  for (const b of stockIns) {
    const qty = _safeNum(b.quantityKg, 0);
    const cpk = _safeNum(b.costPerKg, 0);
    if (qty > 0 && cpk > 0) {
      totalKg += qty;
      totalCost += qty * cpk;
    }
  }

  const avg = totalKg > 0 ? totalCost / totalKg : 0;
  return { avgCostPerKg: avg, totalKgPurchased: totalKg, totalPurchaseCost: totalCost };
};


const calcStockMovementTotals = async ({ start, end, branchKey, movementTypes = [], directions = null } = {}) => {
  const match = {
    movementDate: { $gte: start, $lte: end },
  };
  if (movementTypes && movementTypes.length) match.movementType = { $in: movementTypes };
  if (directions && directions.length) match.direction = { $in: directions };
  const branchMatch = buildBranchOrZoneMatch(branchKey);
  const pipeline = [
    { $match: _andQuery(match, branchMatch) },
    {
      $group: {
        _id: '$movementType',
        quantityKg: { $sum: '$quantityKg' },
        totalCost: { $sum: '$totalCost' },
        count: { $sum: 1 },
      },
    },
  ];
  const rows = await StockMovement.aggregate(pipeline).catch(() => []);
  const byType = {};
  for (const r of rows || []) {
    byType[String(r._id || 'UNKNOWN')] = {
      quantityKg: _safeNum(r.quantityKg, 0),
      totalCost: _safeNum(r.totalCost, 0),
      count: _safeNum(r.count, 0),
    };
  }
  const total = Object.values(byType).reduce((acc, r) => {
    acc.quantityKg += _safeNum(r.quantityKg, 0);
    acc.totalCost += _safeNum(r.totalCost, 0);
    acc.count += _safeNum(r.count, 0);
    return acc;
  }, { quantityKg: 0, totalCost: 0, count: 0 });
  return { ...total, byType };
};

const calcOperationalCogsFromMovements = async ({ start, end, branchKey, reportingScope }) => {
  const saleMovementTypes = [];
  if (scopeIncludesPOS(reportingScope)) saleMovementTypes.push('SALE_DEPLETION');
  if (scopeIncludesDelivery(reportingScope)) saleMovementTypes.push('ORDER_DEPLETION');

  const [sales, variance] = await Promise.all([
    saleMovementTypes.length
      ? calcStockMovementTotals({ start, end, branchKey, movementTypes: saleMovementTypes, directions: ['OUT'] })
      : Promise.resolve({ quantityKg: 0, totalCost: 0, count: 0, byType: {} }),
    calcStockMovementTotals({ start, end, branchKey, movementTypes: ['RECONCILIATION_VARIANCE'], directions: ['OUT'] }),
  ]);

  const saleCogs = _safeNum(sales.totalCost, 0);
  const stockVarianceLoss = _safeNum(variance.totalCost, 0);
  const totalCost = saleCogs + stockVarianceLoss;
  const totalQty = _safeNum(sales.quantityKg, 0) + _safeNum(variance.quantityKg, 0);
  return {
    totalCost,
    saleCogs,
    stockVarianceLoss,
    totalKg: totalQty,
    saleKg: _safeNum(sales.quantityKg, 0),
    stockVarianceKg: _safeNum(variance.quantityKg, 0),
    avgCostPerKg: _safeNum(sales.quantityKg, 0) > 0 ? saleCogs / _safeNum(sales.quantityKg, 0) : 0,
    source: 'StockMovement.totalCost',
    sales,
    variance,
  };
};

/**
 * Helper: Supplier payables (ONLY if you track payment info in StockIn)
 * We will not invent liabilities.
 */
const calcPayablesFromStockIns = (stockIns = []) => {
  let payables = 0;

  for (const s of stockIns) {
    const qty = _safeNum(s.quantityKg, 0);
    const cpk = _safeNum(s.costPerKg, 0);
    const totalCost = qty * cpk;

    const amountPaid = _safeNum(s.amountPaid ?? s.paidAmount, 0);
    const isPaid = typeof s.isPaid === 'boolean' ? s.isPaid : null;
    const paymentStatus = s.paymentStatus ? String(s.paymentStatus).toLowerCase() : null;

    const explicitlyPaid =
      isPaid === true ||
      paymentStatus === 'paid' ||
      paymentStatus === 'settled' ||
      paymentStatus === 'completed' ||
      paymentStatus === 'success' ||
      paymentStatus === 'successful';

    if (explicitlyPaid) continue;

    const hasPaymentSignals = 'amountPaid' in s || 'paidAmount' in s || 'isPaid' in s || 'paymentStatus' in s;
    if (!hasPaymentSignals) continue;

    const outstanding = Math.max(0, totalCost - amountPaid);
    payables += outstanding;
  }

  return payables;
};

/**
 * Helper: Receivables from Delivered-but-unpaid Orders (up to end date)
 */
const calcReceivablesFromOrders = (orders = []) => {
  let receivables = 0;

  for (const o of orders) {
    const st = String(o.status || '').toLowerCase();
    if (st.includes('cancel')) continue;

    // Only Delivered are receivable here
    if (String(o.status || '').toLowerCase() !== 'delivered') continue;

    if (!_isPaid(o.paymentStatus)) {
      receivables += _safeNum(o.grandTotal, 0);
    }
  }

  return receivables;
};

/**
 * Helper: Cash from wallet ledger (optional, best-effort)
 */
const calcCashFromWalletLedger = async (start, end, branchIdOrZoneId = null) => {
  if (!WalletTransaction) return null;

  const branchMatch = buildBranchOrZoneMatch(branchIdOrZoneId);

  // Try A) direction-based, prefer business "date"
  const rowsA = await WalletTransaction.aggregate([
    { $match: { ...branchMatch, date: { $gte: start, $lte: end } } },
    { $group: { _id: '$direction', total: { $sum: '$amount' } } },
  ]);

  const hasDirection = Array.isArray(rowsA) && rowsA.some((r) => r && r._id);
  if (hasDirection) {
    const credit = _safeNum(rowsA.find((r) => String(r._id).toUpperCase() === 'CREDIT')?.total, 0);
    const debit = _safeNum(rowsA.find((r) => String(r._id).toUpperCase() === 'DEBIT')?.total, 0);
    return credit - debit;
  }

  // Try B) type-based, use createdAt, COMPLETED only
  const rowsB = await WalletTransaction.aggregate([
    {
      $match: {
        ...branchMatch,
        createdAt: { $gte: start, $lte: end },
        status: { $in: ['COMPLETED', 'Completed', 'completed'] },
      },
    },
    { $group: { _id: '$type', total: { $sum: '$amount' } } },
  ]);

  if (!Array.isArray(rowsB) || rowsB.length === 0) return null;

  const sumBy = (types) =>
    rowsB
      .filter((r) => types.includes(String(r._id || '').toUpperCase()))
      .reduce((s, r) => s + _safeNum(r.total, 0), 0);

  const credits = sumBy(['DEPOSIT', 'ADJUSTMENT_CREDIT']);
  const debits = sumBy(['WITHDRAWAL', 'REFUND', 'ADJUSTMENT_DEBIT']);

  return credits - debits;
};

/**
 * Expense source strategy:
 * - Primary: ExpenseTransaction (true ledger of expenses; uses ExpenseTransaction.date)
 * - Fallback (ONLY if ExpenseTransaction has none in range):
 *     DailySummary.expenses.total (uses DailySummary.date)
 *
 * This avoids double-counting when you migrated and also logged separately.
 */
const calcExpenses = (expensesTx = [], summaries = []) => {
  const breakdown = {
    salaries: 0,
    logistics: 0,
    utilities: 0,
    maintenance: 0,
    marketing: 0,
    admin: 0,
    total: 0,
    source: 'ExpenseTransaction',
  };

  const applyCategory = (catRaw, amt) => {
    const cat = String(catRaw || '').toLowerCase();

    if (cat.includes('salar') || cat.includes('wages') || cat.includes('staff')) breakdown.salaries += amt;
    else if (
      cat.includes('fuel') ||
      cat.includes('transport') ||
      cat.includes('vehicle') ||
      cat.includes('dispatch') ||
      cat.includes('logistics')
    )
      breakdown.logistics += amt;
    else if (
      cat.includes('power') ||
      cat.includes('electric') ||
      cat.includes('internet') ||
      cat.includes('diesel') ||
      cat.includes('utility')
    )
      breakdown.utilities += amt;
    else if (cat.includes('maint') || cat.includes('repair') || cat.includes('service')) breakdown.maintenance += amt;
    else if (cat.includes('market') || cat.includes('adver') || cat.includes('promo')) breakdown.marketing += amt;
    else breakdown.admin += amt;
  };

  if (Array.isArray(expensesTx) && expensesTx.length > 0) {
    for (const exp of expensesTx) {
      const amt = _safeNum(exp.amount, 0);
      applyCategory(exp.category || exp.type, amt);
      breakdown.total += amt;
    }
    return breakdown;
  }

  // fallback: DailySummary.expenses.total
  breakdown.source = 'DailySummary.expenses.total (fallback)';
  let fallbackTotal = 0;

  for (const s of summaries || []) {
    fallbackTotal += _safeNum(s?.expenses?.total, 0);
  }

  // We cannot categorize reliably from DailySummary totals, so record as admin bucket
  breakdown.admin = fallbackTotal;
  breakdown.total = fallbackTotal;

  return breakdown;
};

// -------------------------
// ✅ NEW: GL helpers (if GL exists)
// -------------------------
const _glEnabled = () => Boolean(ChartOfAccount && GeneralLedgerEntry);

const _loadCOAMap = async () => {
  const rows = await ChartOfAccount.find({ isActive: true }).lean();
  const map = new Map();
  for (const a of rows) map.set(String(a.accountCode), a);
  return map;
};

const _branchKeyMatch = (branchKey) => {
  const values = [...new Set(_splitBranchValues(branchKey))];
  if (!values.length) return null;
  return values.length === 1 ? String(values[0]) : { $in: values.map(String) };
};

const GL_SOURCE_TYPES_BY_SCOPE = Object.freeze({
  // Migrated POS reporting is not only DAILY_SUMMARY. Under the corrected
  // historical GL policy, COGS is posted from OPENING_STOCK/STOCK_IN, and the
  // expected-vs-actual variance file is posted as STOCK_VARIANCE. Excluding
  // those source types makes GL-only P&L show Cost of Sales as zero even while
  // the Trial Balance correctly carries account 5000.
  [REPORTING_SCOPES.POS_ONLY]: ['DAILY_SUMMARY', 'EXPENSE', 'OPENING_STOCK', 'STOCK_IN', 'STOCK_VARIANCE'],
  [REPORTING_SCOPES.DELIVERY_ONLY]: ['ORDER'],
});

const getGLPeriodSourceTypesForScope = (scope) => {
  if (scope === REPORTING_SCOPES.COMBINED) return null; // full GL period view
  return GL_SOURCE_TYPES_BY_SCOPE[scope] || GL_SOURCE_TYPES_BY_SCOPE[REPORTING_SCOPES.POS_ONLY];
};

const _glAggregateAccountSums = async ({ start, end, branchKey, mode, sourceTypes = null }) => {
  // mode: 'period' => start..end
  // mode: 'toEnd'  => <= end
  const match = { status: 'POSTED' };

  if (mode === 'period') match.date = { $gte: start, $lte: end };
  else match.date = { $lte: end };

  const branchMatch = _branchKeyMatch(branchKey);
  if (branchMatch) match.branchKey = branchMatch;
  if (Array.isArray(sourceTypes) && sourceTypes.length) match.sourceType = { $in: sourceTypes.map(String) };

  return GeneralLedgerEntry.aggregate([
    { $match: match },
    { $unwind: '$lines' },
    {
      $group: {
        _id: '$lines.accountCode',
        debit: { $sum: '$lines.debit' },
        credit: { $sum: '$lines.credit' },
      },
    },
  ]);
};

const _computeBalance = (coa, debit, credit) => {
  const nb = coa?.normalBalance || 'DEBIT';
  const d = _safeNum(debit, 0);
  const c = _safeNum(credit, 0);
  // Return signed balance based on normal side
  return nb === 'CREDIT' ? c - d : d - c;
};

const _mapAggRowsToMap = (rows) => {
  const m = new Map();
  for (const r of rows || []) {
    m.set(String(r._id), { debit: _safeNum(r.debit, 0), credit: _safeNum(r.credit, 0) });
  }
  return m;
};

// _computeBalance already applies the account's normal balance.
// Therefore a correctly posted credit-normal account already returns a positive balance.
const _asPositiveForType = (_type, signedBalance) => Math.max(0, _safeNum(signedBalance, 0));

const _getSignedBal = (coaMap, aggMap, code) => {
  const coa = coaMap.get(String(code));
  const row = aggMap.get(String(code)) || { debit: 0, credit: 0 };
  return _computeBalance(coa, row.debit, row.credit);
};

const _glHasAnyEntries = async ({ end, branchKey }) => {
  const q = { status: 'POSTED', date: { $lte: end } };
  const branchMatch = _branchKeyMatch(branchKey);
  if (branchMatch) q.branchKey = branchMatch;
  const one = await GeneralLedgerEntry.findOne(q).select('_id').lean();
  return Boolean(one);
};


const _andQuery = (...clauses) => {
  const clean = clauses.filter((clause) => clause && typeof clause === 'object' && Object.keys(clause).length > 0);
  return clean.length ? { $and: clean } : {};
};

const _notPostedSourceQuery = () => ({
  $or: [
    { 'posting.status': { $exists: false } },
    { 'posting.status': { $nin: ['POSTED', 'posted'] } },
  ],
});

/**
 * Finance accuracy guard.
 * In Auto mode, do not silently produce financial statements from partial GL.
 * If approved operational source documents exist in the selected period but have
 * not been posted successfully, Auto falls back to operational management mode.
 * Users can still force GL-only with sourceMode=gl.
 */
const _getOperationalPostingBacklog = async ({ start, end, branchKey }) => {
  const branchMatch = buildBranchOrZoneMatch(branchKey);
  const notPosted = _notPostedSourceQuery();

  const [dailySummaries, expenses, stockIns, failedJournals] = await Promise.all([
    DailySummary.countDocuments(_andQuery(
      branchMatch,
      { date: { $gte: start, $lte: end } },
      { status: { $in: ['approved', 'posted', 'closed'] } },
      notPosted
    )).catch(() => 0),
    ExpenseTransaction.countDocuments(_andQuery(
      branchMatch,
      { date: { $gte: start, $lte: end } },
      { status: { $in: ['approved', 'Approved', 'APPROVED', 'posted', 'POSTED'] } },
      notPosted
    )).catch(() => 0),
    StockIn.countDocuments(_andQuery(
      branchMatch,
      { purchaseDate: { $gte: start, $lte: end } },
      notPosted
    )).catch(() => 0),
    _glEnabled()
      ? GeneralLedgerEntry.countDocuments(_andQuery(
          { date: { $gte: start, $lte: end } },
          branchKey ? { branchKey: _branchKeyMatch(branchKey) } : {},
          { status: 'FAILED' }
        )).catch(() => 0)
      : Promise.resolve(0),
  ]);

  const total = _safeNum(dailySummaries) + _safeNum(expenses) + _safeNum(stockIns) + _safeNum(failedJournals);
  return {
    complete: total === 0,
    total,
    dailySummaries: _safeNum(dailySummaries),
    expenses: _safeNum(expenses),
    stockIns: _safeNum(stockIns),
    failedJournals: _safeNum(failedJournals),
  };
};


// -------------------------
// Wave 11A: Optional settlement / revenue assurance helpers
// -------------------------
const SETTLEMENT_METHODS = ['cash', 'transfer', 'pos'];

const _actor = (req) =>
  req?.user?.name ||
  req?.user?.fullName ||
  req?.user?.email ||
  req?.user?.id ||
  req?.user?._id ||
  'system';

const _normalizeMethod = (v) => {
  const m = String(v || '').trim().toLowerCase();
  if (['cash', 'c'].includes(m)) return 'cash';
  if (['transfer', 'bank', 'bank_transfer', 'bank-transfer'].includes(m)) return 'transfer';
  if (['pos', 'card', 'terminal'].includes(m)) return 'pos';
  return null;
};

const _parseDateOrNull = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const _businessDateBounds = (dateValue) => {
  const d = dateValue ? new Date(dateValue) : new Date();
  if (Number.isNaN(d.getTime())) return _businessDateBounds(new Date());
  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  const end = new Date(d);
  end.setHours(23, 59, 59, 999);
  return { start, end };
};

const _settlementProjection = (doc) => {
  if (!doc) return null;
  const row = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return {
    _id: row._id,
    dailySummaryId: row.dailySummaryId,
    dailySummaryBusinessId: row.dailySummaryBusinessId,
    businessDate: row.businessDate,
    branchId: row.branchId,
    cashierName: row.cashierName,
    expected: row.expected || {},
    cash: row.cash || {},
    transfer: row.transfer || {},
    pos: row.pos || {},
    settlementStatus: row.settlementStatus || 'NOT_REVIEWED',
    isOptionalControl: row.isOptionalControl !== false,
    lastReviewedBy: row.lastReviewedBy,
    lastReviewedAt: row.lastReviewedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
};

const _deriveExpectedForSummary = async (summary) => {
  const summaryId = summary?._id;
  const branchKey = String(summary?.branchId || '');
  const { start, end } = _businessDateBounds(summary?.date);

  let saleAgg = [];
  try {
    saleAgg = await SaleTransaction.aggregate([
      {
        $match: {
          dailySummaryId: summaryId,
          status: { $nin: ['voided', 'reversed', 'rejected'] },
          'voiding.isVoided': { $ne: true },
        },
      },
      {
        $group: {
          _id: null,
          cashAmount: { $sum: '$cashAmount' },
          transferAmount: { $sum: '$transferAmount' },
          posAmount: { $sum: '$posAmount' },
          totalRevenue: { $sum: '$totalRevenue' },
        },
      },
    ]);
  } catch (e) {
    saleAgg = [];
  }

  const saleRow = saleAgg[0] || {};
  const cashSales = _safeNum(saleRow.cashAmount, _safeNum(summary?.sales?.cashAmount, 0));
  const transferSales = _safeNum(saleRow.transferAmount, _safeNum(summary?.sales?.transferAmount, 0));
  const posSales = _safeNum(saleRow.posAmount, _safeNum(summary?.sales?.posAmount, 0));

  // Cash expenses reduce the expected physical cash on hand.
  const cashExpenseAgg = await ExpenseTransaction.aggregate([
    {
      $match: {
        $or: [
          { dailySummaryId: summaryId },
          {
            branchId: branchKey,
            date: { $gte: start, $lte: end },
          },
        ],
        paymentDisposition: { $in: ['CASH', 'cash'] },
        status: { $nin: ['voided', 'reversed', 'rejected'] },
        'voiding.isVoided': { $ne: true },
      },
    },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);

  const cashExpenses = _safeNum(cashExpenseAgg?.[0]?.total, 0);
  const expectedCashOnHand = cashSales - cashExpenses;

  return {
    cashSales,
    cashExpenses,
    expectedCashOnHand,
    transferSales,
    posSales,
    totalExpectedSettlement: expectedCashOnHand + transferSales + posSales,
  };
};

const _ensureSettlementForSummary = async (summary, actor = 'system') => {
  if (!summary?._id) return null;

  const expected = await _deriveExpectedForSummary(summary);
  const existing = await SettlementConfirmation.findOne({ dailySummaryId: summary._id });

  const methodUpdates = {
    'cash.expectedAmount': expected.expectedCashOnHand,
    'transfer.expectedAmount': expected.transferSales,
    'pos.expectedAmount': expected.posSales,
  };

  const base = {
    dailySummaryId: summary._id,
    dailySummaryBusinessId: summary.dailySummaryId || null,
    businessDate: summary.date,
    branchId: String(summary.branchId || ''),
    cashierName: summary.cashierName || null,
    expected,
    isOptionalControl: true,
    ...methodUpdates,
  };

  let doc;
  if (existing) {
    existing.set(base);
    doc = await existing.save();
  } else {
    doc = await SettlementConfirmation.create({
      ...base,
      cash: { expectedAmount: expected.expectedCashOnHand, status: 'NOT_REVIEWED' },
      transfer: { expectedAmount: expected.transferSales, status: 'NOT_REVIEWED' },
      pos: { expectedAmount: expected.posSales, status: 'NOT_REVIEWED' },
      lastReviewedBy: actor,
      lastReviewedAt: null,
    });
  }

  // Optional denormalized marker on DailySummary. This must not be used as a blocker.
  await DailySummary.updateOne(
    { _id: summary._id },
    {
      $set: {
        'settlement.status': doc.settlementStatus,
        'settlement.confirmationId': doc._id,
        'settlement.isOptionalControl': true,
      },
    }
  );

  return doc;
};

const _buildSummaryMatchForSettlement = (req) => {
  const { period, startDate, endDate, branchId, serviceZoneId, status } = req.query;
  const branchKey = branchId || serviceZoneId || null;
  const { start, end } = getDateRange(period || 'custom', startDate, endDate);
  const match = { date: { $gte: start, $lte: end } };

  if (branchKey) Object.assign(match, buildBranchOrZoneMatch(branchKey));
  if (status) match.status = status;

  return { match, start, end, branchKey };
};

const _autoStatusForMethod = (expected, actual, explicitStatus) => {
  if (explicitStatus) return explicitStatus;
  if (actual === null || actual === undefined || actual === '') return 'NOT_REVIEWED';
  const variance = _safeNum(expected, 0) - _safeNum(actual, 0);
  return Math.abs(variance) > 0.01 ? 'VARIANCE_DETECTED' : 'FULLY_CONFIRMED';
};

const _splitDelimitedLine = (line) => {
  const delimiter = line.includes('\t') ? '\t' : ',';
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
};

const _parseStatementRows = (rawText, explicitRows = []) => {
  if (Array.isArray(explicitRows) && explicitRows.length > 0) {
    return explicitRows.map((r) => ({ ...r, raw: r }));
  }

  const text = String(rawText || '').trim();
  if (!text) return [];

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const header = _splitDelimitedLine(lines[0]).map((h) => String(h || '').trim().toLowerCase());
  const hasHeader = header.some((h) => ['date', 'transactiondate', 'transaction_date', 'reference', 'amount', 'debit', 'credit', 'narration'].includes(h.replace(/\s+/g, '')));
  const startIndex = hasHeader ? 1 : 0;
  const keys = hasHeader
    ? header.map((h) => h.replace(/\s+/g, '').replace(/[^a-z0-9_]/g, ''))
    : ['transactiondate', 'reference', 'narration', 'amount', 'debit', 'credit'];

  return lines.slice(startIndex).map((line) => {
    const values = _splitDelimitedLine(line);
    const obj = {};
    keys.forEach((key, idx) => {
      obj[key] = values[idx];
    });
    return { ...obj, raw: { line } };
  });
};

const _numFromLoose = (v) => {
  if (v === null || v === undefined) return 0;
  const cleaned = String(v).replace(/[₦,\s]/g, '').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
};

const _normaliseStatementRows = (rows, fallbackBranchId = null) => {
  const refCounts = new Map();

  const mapped = (rows || []).map((r) => {
    const transactionDate =
      _parseDateOrNull(r.transactionDate || r.transactiondate || r.transaction_date || r.date || r.valueDate || r.valuedate);
    const reference = String(r.reference || r.ref || r.transactionReference || r.transactionreference || r.rrn || '').trim() || null;
    const narration = String(r.narration || r.description || r.memo || r.details || '').trim() || null;
    const debit = _numFromLoose(r.debit || r.withdrawal || r.outflow);
    const credit = _numFromLoose(r.credit || r.deposit || r.inflow);
    const amount = _numFromLoose(r.amount || r.value || r.total) || credit - debit;
    const branchId = String(r.branchId || r.branch || fallbackBranchId || '').trim() || null;
    const channel = String(r.channel || r.source || r.terminal || '').trim() || null;

    if (reference) refCounts.set(reference, (refCounts.get(reference) || 0) + 1);

    return {
      transactionDate,
      reference,
      narration,
      amount,
      debit,
      credit,
      channel,
      branchId,
      status: 'UNMATCHED',
      raw: r.raw || r,
    };
  });

  return mapped.map((r) => ({
    ...r,
    status: r.reference && refCounts.get(r.reference) > 1 ? 'DUPLICATE_REFERENCE' : 'UNMATCHED',
  }));
};


const _matchStatementRowsToSettlements = async ({ rows, sourceType, branchId, periodStart, periodEnd }) => {
  const q = {};
  if (branchId) q.branchId = String(branchId);
  if (periodStart || periodEnd) {
    q.businessDate = {};
    const ps = _parseDateOrNull(periodStart);
    const pe = _parseDateOrNull(periodEnd);
    if (ps) q.businessDate.$gte = ps;
    if (pe) {
      pe.setHours(23, 59, 59, 999);
      q.businessDate.$lte = pe;
    }
    if (Object.keys(q.businessDate).length === 0) delete q.businessDate;
  }

  const settlements = await SettlementConfirmation.find(q).limit(1000).lean();
  const refMap = new Map();

  const methodFromSource = String(sourceType || '').toUpperCase() === 'POS' ? ['pos'] : ['cash', 'transfer', 'pos'];

  for (const settlement of settlements || []) {
    for (const method of methodFromSource) {
      const row = settlement?.[method] || {};
      const ref = String(row.reference || '').trim();
      if (!ref) continue;
      refMap.set(ref, {
        settlementId: settlement._id,
        method,
        expected: _safeNum(row.expectedAmount, 0),
        actual: row.actualAmount === null || row.actualAmount === undefined ? null : _safeNum(row.actualAmount, 0),
      });
    }
  }

  return (rows || []).map((row) => {
    if (row.status === 'DUPLICATE_REFERENCE') return row;
    const ref = String(row.reference || '').trim();
    if (!ref || !refMap.has(ref)) return { ...row, status: 'UNMATCHED' };

    const match = refMap.get(ref);
    const compareAmount = match.actual !== null ? match.actual : match.expected;
    const rowAmount = Math.abs(_safeNum(row.amount, 0) || _safeNum(row.credit, 0) || _safeNum(row.debit, 0));
    const diff = rowAmount - compareAmount;

    let status = 'MATCHED';
    if (Math.abs(diff) > 0.01 && rowAmount < compareAmount) status = 'UNDER_SETTLED';
    if (Math.abs(diff) > 0.01 && rowAmount > compareAmount) status = 'OVER_SETTLED';

    return {
      ...row,
      status,
      matchedSettlementId: match.settlementId,
      matchNote: `${match.method.toUpperCase()} settlement reference matched; difference ${diff}`,
    };
  });
};

const _statementSummary = (rows = []) => {
  const summary = rows.reduce(
    (acc, r) => {
      acc.rowCount += 1;
      acc.totalDebit += _safeNum(r.debit, 0);
      acc.totalCredit += _safeNum(r.credit, 0);
      acc.totalAmount += _safeNum(r.amount, 0);
      if (r.status === 'DUPLICATE_REFERENCE') acc.duplicateReferenceCount += 1;
      if (r.status === 'UNMATCHED') acc.unmatchedCount += 1;
      if (r.status === 'MATCHED') acc.matchedCount += 1;
      return acc;
    },
    {
      rowCount: 0,
      totalDebit: 0,
      totalCredit: 0,
      totalAmount: 0,
      duplicateReferenceCount: 0,
      unmatchedCount: 0,
      matchedCount: 0,
    }
  );
  return summary;
};

const _safeCsv = (value) => {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
};

/**
 * @desc    Generate Financial Statements
 * @route   GET /api/v2/financials/statements
 *
 * Supports:
 *  - period=monthly|quarterly|yearly|custom
 *  - startDate, endDate (custom)
 *  - branchId OR serviceZoneId (treat as same concept)
 *
 * CRITICAL ACCURACY FIXES:
 *  - Orders filtered by orderDate (fallback createdAt only when orderDate missing)
 *  - ExpenseTransaction filtered by date (NOT createdAt)
 *  - POS DailySummary filtered ONLY by DailySummary.date (NOT createdAt)
 *  - Delivery revenue recognized ONLY when paid
 *
 * ✅ NEW:
 *  - If General Ledger exists AND has postings, statements are generated from GL (audit-grade)
 *  - Otherwise fallback to operational aggregation (your existing logic)
 */
const getFinancialStatements = async (req, res, next) => {
  try {
    const { period, startDate: qStart, endDate: qEnd, branchId, serviceZoneId } = req.query;
    const branchKey = branchId || serviceZoneId || null;
    const sourceMode = normalizeSourceMode(req.query.sourceMode || req.query.source || 'auto');
    const reportingScope = normalizeReportingScope(req.query.reportingScope || req.query.revenueScope || req.query.scope);
    const includePOSRevenue = scopeIncludesPOS(reportingScope);
    const includeDeliveryRevenue = scopeIncludesDelivery(reportingScope);
    const financeSettings = await getFinanceSettings();

    const { start, end } = getDateRange(period, qStart, qEnd);
    let glPostingBacklog = null;
    if (_glEnabled()) {
      glPostingBacklog = await _getOperationalPostingBacklog({ start, end, branchKey }).catch(() => null);
    }

    // -------------------------
    // ✅ GL MODE (preferred only when complete in Auto mode; forced when sourceMode=gl)
    // -------------------------
    if (_glEnabled() && sourceMode !== 'operational') {
      const hasAny = await _glHasAnyEntries({ end, branchKey });
      if (hasAny) {
        const coaMap = await _loadCOAMap();

        const glPeriodSourceTypes = getGLPeriodSourceTypesForScope(reportingScope);
        const periodRows = await _glAggregateAccountSums({ start, end, branchKey, mode: 'period', sourceTypes: glPeriodSourceTypes });
        const toEndRows = await _glAggregateAccountSums({ start, end, branchKey, mode: 'toEnd' });

        const periodMap = _mapAggRowsToMap(periodRows);
        const toEndMap = _mapAggRowsToMap(toEndRows);

        // ---- P&L (period) ----
        const signedRevPos = _getSignedBal(coaMap, periodMap, '4000'); // INCOME
        const signedRevDel = _getSignedBal(coaMap, periodMap, '4010'); // INCOME
        const signedCogs = _getSignedBal(coaMap, periodMap, '5000');   // EXPENSE
        const signedInventoryVariance = _getSignedBal(coaMap, periodMap, '5100'); // EXPENSE

        const signedSalaries = _getSignedBal(coaMap, periodMap, '6000');
        const signedLogistics = _getSignedBal(coaMap, periodMap, '6100');
        const signedUtilities = _getSignedBal(coaMap, periodMap, '6200');
        const signedMaintenance = _getSignedBal(coaMap, periodMap, '6300');
        const signedMarketing = _getSignedBal(coaMap, periodMap, '6400');
        const signedAdmin = _getSignedBal(coaMap, periodMap, '6500');

        const revenuePOS = includePOSRevenue ? _asPositiveForType('INCOME', signedRevPos) : 0;
        const revenueDeliveryRecognized = includeDeliveryRevenue ? _asPositiveForType('INCOME', signedRevDel) : 0;
        const revenueOther = 0;

        const totalRevenue = revenuePOS + revenueDeliveryRecognized + revenueOther;

        const saleCogs = _asPositiveForType('EXPENSE', signedCogs);
        const inventoryVarianceCogs = _asPositiveForType('EXPENSE', signedInventoryVariance);
        // Gross profit deducts both the actual LPG purchase-cost release (5000)
        // and the migrated expected-vs-actual variance separately posted to 5100.
        // The frontend displays them as two lines so account 5000 ties visibly
        // to the Trial Balance while 5100 remains separately auditable.
        const calculatedCogs = saleCogs + inventoryVarianceCogs;

        const salaries = _asPositiveForType('EXPENSE', signedSalaries);
        const logistics = _asPositiveForType('EXPENSE', signedLogistics);
        const utilities = _asPositiveForType('EXPENSE', signedUtilities);
        const maintenance = _asPositiveForType('EXPENSE', signedMaintenance);
        const marketing = _asPositiveForType('EXPENSE', signedMarketing);
        const admin = _asPositiveForType('EXPENSE', signedAdmin);

        const totalOpex = salaries + logistics + utilities + maintenance + marketing + admin;

        const grossProfit = totalRevenue - calculatedCogs;
        const ebitda = grossProfit - totalOpex;

        // If you later post depreciation/interest/tax journals, these will become real.
        const depreciation = 0;
        const interestExpense = 0;
        const tax = 0;
        const netIncome = ebitda - depreciation - interestExpense - tax;
        const dscrMeta = computeDscrMeta({ ebitda, debtService: 0, showWhenNoDebt: financeSettings.showDscrWhenNoDebt });

        // ---- Balance Sheet (to end) ----
        const cashOnHand = _asPositiveForType('ASSET', _getSignedBal(coaMap, toEndMap, '1000'));
        const bankTransfers = _asPositiveForType('ASSET', _getSignedBal(coaMap, toEndMap, '1010'));
        const bankPOS = _asPositiveForType('ASSET', _getSignedBal(coaMap, toEndMap, '1020'));
        const receivables = _asPositiveForType('ASSET', _getSignedBal(coaMap, toEndMap, '1100'));
        const inventoryVal = _asPositiveForType('ASSET', _getSignedBal(coaMap, toEndMap, '1200'));

        const payables = _asPositiveForType('LIABILITY', _getSignedBal(coaMap, toEndMap, '2000'));
        const accrued = _asPositiveForType('LIABILITY', _getSignedBal(coaMap, toEndMap, '2100'));
        const taxPayable = _asPositiveForType('LIABILITY', _getSignedBal(coaMap, toEndMap, '2200'));

        const shareCapital = _asPositiveForType('EQUITY', _getSignedBal(coaMap, toEndMap, '3000'));
        const retainedEarnings = _asPositiveForType('EQUITY', _getSignedBal(coaMap, toEndMap, '3100'));

        const hasMeaningfulStatementActivity = Math.abs(totalRevenue) > 0 || Math.abs(calculatedCogs) > 0 || Math.abs(totalOpex) > 0 || Math.abs(cashOnHand + bankTransfers + bankPOS + receivables + inventoryVal + payables + accrued + taxPayable + shareCapital + retainedEarnings) > 0;

        const responseData = {
          income: {
            revenue: {
              total: totalRevenue,
              lpg: totalRevenue,
              delivery: revenueDeliveryRecognized,
              pos: revenuePOS,
              other: revenueOther,

              // GL mode: these are not computed unless you post invoice/AR-specific journals separately.
              deliveryInvoiced: null,
              deliveryUnpaidDelivered: null,
            },
            cogs: {
              total: calculatedCogs,
              purchases: null,
              avgCostPerKg: null,
              totalKgSold: null,
              source: 'GeneralLedgerEntry',
              saleDepletion: saleCogs,
              inventoryVariance: inventoryVarianceCogs,
              directCostTotal: calculatedCogs,
              sourceTypes: glPeriodSourceTypes,
            },
            grossProfit,
            expenses: {
              salaries,
              logistics,
              utilities,
              maintenance,
              marketing,
              admin,
              total: totalOpex,
              source: 'GeneralLedgerEntry',
            },
            ebitda,
            depreciation,
            interest: interestExpense,
            tax,
            netIncome,
          },
          balance: {
            assets: [
              { name: 'Cash on Hand', value: _safeNum(cashOnHand, 0) },
              { name: 'Bank - Transfers', value: _safeNum(bankTransfers, 0) },
              { name: 'Bank - POS Settlements', value: _safeNum(bankPOS, 0) },
              { name: 'Inventory Stock', value: _safeNum(inventoryVal, 0) },
              { name: 'Trade Receivables', value: _safeNum(receivables, 0) },
            ],
            liabilities: [
              { name: 'Trade Payables', value: _safeNum(payables, 0) },
              { name: 'Accrued Expenses', value: _safeNum(accrued, 0) },
              { name: 'Tax Payable', value: _safeNum(taxPayable, 0) },
            ],
            equity: [
              { name: 'Share Capital', value: _safeNum(shareCapital, 0) },
              { name: 'Retained Earnings', value: _safeNum(retainedEarnings, 0) },
            ],
            inventoryMeta: {
              remainingKg: null,
              valuationMethod: 'GL account 1200 (Inventory - LPG)',
            },
            cashMeta: {
              source: 'General Ledger (double-entry)',
            },
            cautions: [
              'Statements generated from General Ledger postings (audit-grade).',
              'Depreciation/Interest/Tax are 0 unless you post journal entries for them.',
              'If you need delivery invoiced vs recognized breakdown, post an invoice/AR journal or derive from Orders in a separate reconciliation report.',
            ],
          },
          cashFlow: {
            operating: ebitda - tax,
            investing: 0,
            financing: 0,
          },
          ratios: {
            grossMargin: totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0,
            netMargin: totalRevenue > 0 ? (netIncome / totalRevenue) * 100 : 0,
            dscr: dscrMeta.dscr,
            dscrDebtService: dscrMeta.debtService,
            dscrStatus: dscrMeta.status,
            dscrExplanation: dscrMeta.explanation,
          },
          period: { start, end },
          taxPolicy: {
            source: financeSettings.source,
            companyIncomeTaxPercentage: financeSettings.companyIncomeTaxPercentage,
            vatPercentage: financeSettings.vatPercentage,
            withholdingTaxPercentage: financeSettings.withholdingTaxPercentage,
            note: 'GL mode only shows tax if tax journals are posted. Configure rates in Business Setup → Finance & Tax Settings.',
          },
          reportingScope: { value: reportingScope, label: reportingScopeLabel(reportingScope), includePOSRevenue, includeDeliveryRevenue },
          branch: {
            branchId: branchKey,
            note: branchKey ? 'Filtered by branchId/serviceZoneId (GL branchKey)' : 'All branches combined',
          },
          reportingPolicy: buildReportingPolicyMeta({
            sourceMode,
            resolvedSourceMode: 'gl',
            period,
            reportingScope,
            start,
            end,
            branchKey,
            glCompleteness: glPostingBacklog,
          }),
          gl: {
            enabled: true,
            sourceMode: 'gl',
            periodSourceTypes: glPeriodSourceTypes,
            completeness: glPostingBacklog,
            warning: glPostingBacklog && !glPostingBacklog.complete
              ? 'GL has posted activity, but selected-period operational source documents are still unposted/failed. Auto mode will use operational fallback; GL-only was requested or explicitly returned.'
              : null,
          },
        };

        if (sourceMode === 'gl') {
          return res.status(200).json(responseData);
        }

        if (hasMeaningfulStatementActivity && (!glPostingBacklog || glPostingBacklog.complete)) {
          return res.status(200).json(responseData);
        }

        // Auto mode: GL exists, but no meaningful statement activity was found for this
        // period/branch. Fall through to operational aggregation so management users
        // still see POS/orders/expenses while the GL posting backlog is being completed.
      }
    }

    // -------------------------
    // FALLBACK MODE (operational aggregation)
    // -------------------------
    const branchMatch = buildBranchOrZoneMatch(branchKey);

    // -------------------------
    // DATA FETCH (parallel)
    // -------------------------
    const [
      ordersDeliveredInPeriod,
      posSummariesApproved,
      expensesInPeriod,
      assets,
      loans,
      stockInsInPeriod,
      stockInsUpToEnd,
      deliveredOrdersUpToEnd,
    ] = await Promise.all([
      // DELIVERY SALES: Orders (use orderDate, fallback createdAt ONLY if orderDate missing)
      Order.find({
        ...branchMatch,
        ..._ordersDeliveryGuard(),
        status: 'Delivered',
        $or: [
          { orderDate: { $gte: start, $lte: end } },
          { orderDate: { $exists: false }, createdAt: { $gte: start, $lte: end } },
        ],
      })
        .select('grandTotal items paymentMethod paymentStatus status createdAt orderDate branchId channel serviceZoneId zoneId plantId')
        .lean(),

      // ✅ POS SALES: Daily Summary — filter ONLY by business date field (date), NOT createdAt
      DailySummary.find({
        ...branchMatch,
        status: 'approved',
        date: { $gte: start, $lte: end },
      }).lean(),

      // ✅ EXPENSES: IMPORTANT -> use business "date", NOT createdAt
      ExpenseTransaction.find({
        ...branchMatch,
        date: { $gte: start, $lte: end },
      }).lean(),

      Asset.find({}).lean(),
      Loan.find({}).lean(),

      // Stock purchases in period
      StockIn.find({
        ...branchMatch,
        purchaseDate: { $gte: start, $lte: end },
      }).lean(),

      // Stock purchases up to end date (for WAC + inventory valuation)
      StockIn.find({
        ...branchMatch,
        purchaseDate: { $lte: end },
      }).lean(),

      // Delivered orders up to end date (for receivables)
      Order.find({
        ...branchMatch,
        ..._ordersDeliveryGuard(),
        status: 'Delivered',
        $or: [
          { orderDate: { $lte: end } },
          { orderDate: { $exists: false }, createdAt: { $lte: end } },
        ],
      })
        .select('grandTotal paymentStatus status createdAt orderDate branchId channel serviceZoneId zoneId plantId')
        .lean(),
    ]);

    // -------------------------
    // A) INCOME STATEMENT (P&L)
    // -------------------------
    const delivery = calcDeliverySales(ordersDeliveredInPeriod);
    const pos = calcPosSales(posSummariesApproved);

    // ✅ Revenue recognition + source scope:
    // - Default source scope is migrated POS/DailySummary only.
    // - App delivery orders are excluded unless the user explicitly selects app_delivery_only or combined_business.
    const revenueDeliveryRecognized = includeDeliveryRevenue ? delivery.recognizedRevenue : 0;
    const revenueDeliveryInvoiced = includeDeliveryRevenue ? delivery.invoicedRevenue : 0;
    const revenueDeliveryUnpaidDelivered = includeDeliveryRevenue ? delivery.unpaidDelivered : 0;
    const excludedDeliveryRecognized = includeDeliveryRevenue ? 0 : delivery.recognizedRevenue;
    const excludedDeliveryInvoiced = includeDeliveryRevenue ? 0 : delivery.invoicedRevenue;
    const excludedDeliveryUnpaidDelivered = includeDeliveryRevenue ? 0 : delivery.unpaidDelivered;

    const revenuePOS = includePOSRevenue ? pos.revenue : 0;
    const revenueOther = 0;

    const totalRevenue = revenueDeliveryRecognized + revenuePOS + revenueOther;
    const totalKgSold = (includeDeliveryRevenue ? _safeNum(delivery.kgSold, 0) : 0) + (includePOSRevenue ? _safeNum(pos.kgSold, 0) : 0);

    // Purchases in period (real)
    const purchases = (stockInsInPeriod || []).reduce(
      (sum, s) => sum + _safeNum(s.quantityKg, 0) * _safeNum(s.costPerKg, 0),
      0
    );

    // ✅ COGS: use the same StockMovement depletion ledger as Executive Dashboard.
    // This prevents Financial Statements from using WAC while Dashboard uses actual depletion costs.
    const cogsFromMovements = await calcOperationalCogsFromMovements({ start, end, branchKey, reportingScope });
    const calculatedCogs = _safeNum(cogsFromMovements.totalCost, 0);
    const avgCostPerKg = _safeNum(cogsFromMovements.avgCostPerKg, 0);

    // ✅ OPEX: primary from ExpenseTransaction.date; fallback only if none found
    const expenseBreakdown = calcExpenses(expensesInPeriod, posSummariesApproved);
    const totalOpex = _safeNum(expenseBreakdown.total, 0);

    const grossProfit = totalRevenue - calculatedCogs;
    const ebitda = grossProfit - totalOpex;

    // Depreciation (proxy unless you implement schedules)
    const totalFixedAssets = (assets || []).reduce((sum, a) => sum + _safeNum(a.cost, 0), 0);
    const annualDepreciation = (assets || []).reduce((sum, a) => sum + _safeNum(a.cost, 0) * 0.15, 0); // 15% proxy
    const depreciation = period === 'monthly' ? annualDepreciation / 12 : annualDepreciation;

    // Interest (proxy from Loan model)
    const interestExpense = (loans || []).reduce((sum, l) => {
      const principal = _safeNum(l.principal, 0);
      const rate = _safeNum(l.interestRate, 0) / 100;
      if (principal <= 0 || rate <= 0) return sum;
      return sum + (principal * rate) / (period === 'monthly' ? 12 : 1);
    }, 0);

    const profitBeforeTax = ebitda - depreciation - interestExpense;
    const taxRate = _safeNum(financeSettings.companyIncomeTaxPercentage, 30) / 100;
    const tax = financeSettings.applyCompanyIncomeTaxProvision && profitBeforeTax > 0 ? profitBeforeTax * taxRate : 0;
    const netIncome = profitBeforeTax - tax;

    // -------------------------
    // B) BALANCE SHEET
    // -------------------------
    const inventory = calcInventoryValuation(stockInsUpToEnd);

    // ✅ Receivables = Delivered but unpaid (up to end)
    const receivables = includeDeliveryRevenue ? calcReceivablesFromOrders(deliveredOrdersUpToEnd) : 0;

    // Payables (only if StockIn has payment fields)
    const payables = calcPayablesFromStockIns(stockInsUpToEnd);

    // Cash: ledger preferred; fallback estimate if ledger not available
    let cashFromLedger = null;
    try {
      cashFromLedger = await calcCashFromWalletLedger(start, end, branchKey);
    } catch (e) {
      cashFromLedger = null;
    }

    // Fallback cash estimate (not audit-grade)
    const cashFallback = totalRevenue - totalOpex - purchases;
    const cash = cashFromLedger !== null ? cashFromLedger : cashFallback;

    const accumulatedDepreciation = Math.min(totalFixedAssets, totalFixedAssets * 0.3); // proxy
    const netFixedAssets = totalFixedAssets - accumulatedDepreciation;

    const liabilities = {
      payables,
      taxPayable: tax,
      longTermLoans: (loans || []).reduce((sum, l) => sum + _safeNum(l.principal, 0), 0),
    };

    const equity = {
      shareCapital: 10_000_000, // move to settings later
      retainedEarnings: Math.max(0, netIncome),
    };

    // -------------------------
    // C) RATIOS
    // -------------------------
    const annualDebtService = (loans || []).reduce((sum, l) => {
      const principal = _safeNum(l.principal, 0);
      const term = _safeNum(l.term, 0);
      const rate = _safeNum(l.interestRate, 0) / 100;
      if (principal <= 0) return sum;

      const principalRepay = term > 0 ? principal / term : 0;
      const interest = principal * rate;
      return sum + principalRepay + interest;
    }, 0);

    const periodDebtService = period === 'monthly' ? annualDebtService / 12 : annualDebtService;
    const dscrMeta = computeDscrMeta({ ebitda, debtService: periodDebtService, showWhenNoDebt: financeSettings.showDscrWhenNoDebt });
    const dscr = dscrMeta.dscr;

    const responseData = {
      income: {
        revenue: {
          total: totalRevenue,
          lpg: revenueDeliveryRecognized + revenuePOS,
          delivery: revenueDeliveryRecognized,
          pos: revenuePOS,
          other: revenueOther,

          // ✅ transparency/debug/reconciliation
          deliveryInvoiced: revenueDeliveryInvoiced,
          deliveryUnpaidDelivered: revenueDeliveryUnpaidDelivered,
        },
        cogs: {
          total: calculatedCogs,
          purchases,
          avgCostPerKg,
          totalKgSold,
          source: cogsFromMovements?.source || 'StockMovement.totalCost',
          saleDepletion: _safeNum(cogsFromMovements?.saleCogs, 0),
          inventoryVariance: _safeNum(cogsFromMovements?.stockVarianceLoss, 0),
          movementKg: _safeNum(cogsFromMovements?.totalKg, 0),
          saleKg: _safeNum(cogsFromMovements?.saleKg, 0),
          stockVarianceKg: _safeNum(cogsFromMovements?.stockVarianceKg, 0),
          movementCount: _safeNum(cogsFromMovements?.sales?.count, 0) + _safeNum(cogsFromMovements?.variance?.count, 0),
        },
        grossProfit,
        expenses: {
          salaries: _safeNum(expenseBreakdown.salaries, 0),
          logistics: _safeNum(expenseBreakdown.logistics, 0),
          utilities: _safeNum(expenseBreakdown.utilities, 0),
          maintenance: _safeNum(expenseBreakdown.maintenance, 0),
          marketing: _safeNum(expenseBreakdown.marketing, 0),
          admin: _safeNum(expenseBreakdown.admin, 0),
          total: totalOpex,
          source: expenseBreakdown.source,
        },
        ebitda,
        depreciation,
        interest: interestExpense,
        tax,
        netIncome,
      },
      balance: {
        assets: [
          { name: 'Net Fixed Assets (PPE)', value: _safeNum(netFixedAssets, 0) },
          { name: 'Cash & Equivalents', value: Math.abs(_safeNum(cash, 0)) },
          { name: 'Inventory Stock', value: _safeNum(inventory.totalValue, 0) },
          { name: 'Trade Receivables', value: _safeNum(receivables, 0) },
        ],
        liabilities: [
          { name: 'Trade Payables', value: _safeNum(liabilities.payables, 0) },
          { name: 'Tax Provision', value: _safeNum(liabilities.taxPayable, 0) },
          { name: 'Long Term Loans', value: _safeNum(liabilities.longTermLoans, 0) },
        ],
        equity: [
          { name: 'Share Capital', value: _safeNum(equity.shareCapital, 0) },
          { name: 'Retained Earnings', value: _safeNum(equity.retainedEarnings, 0) },
        ],
        inventoryMeta: {
          remainingKg: _safeNum(inventory.totalRemainingKg, 0),
          valuationMethod: 'SUM(StockIn.remainingKg * StockIn.costPerKg)',
        },
        cashMeta: {
          source:
            cashFromLedger !== null
              ? 'WalletTransaction ledger/proxy (best-effort)'
              : 'Fallback estimate (recognized revenue - opex - purchases)',
        },
        cautions: [
          'COGS uses StockMovement sale depletion + inventory variance costs, matching the Executive Dashboard stock ledger basis. If COGS is zero, rebuild stock movements before relying on this view.',
          'Payables only computed if StockIn includes payment fields (amountPaid/isPaid/paymentStatus). Otherwise payables remain 0 (no assumptions).',
          'Delivery revenue is recognized only when paid. Delivered-but-unpaid orders are treated as Receivables.',
          'POS revenue is sourced from approved DailySummary records filtered by DailySummary.date (business date), not createdAt.',
          `Expenses are sourced from ${expenseBreakdown.source}. Filtering is always by business date (ExpenseTransaction.date / DailySummary.date).`,
          'WalletTransaction is not a perfect substitute for a bank/cash ledger; treat cashMeta as indicative until you implement a true General Ledger.',
          'GL module: if ChartOfAccount + GeneralLedgerEntry exist and have postings, statements automatically switch to GL mode.',
        ],
      },
      cashFlow: {
        operating: ebitda + depreciation - tax,
        investing:
          -1 *
          (assets || [])
            .filter((a) => a?.createdAt && new Date(a.createdAt) > start)
            .reduce((s, a) => s + _safeNum(a.cost, 0), 0),
        financing:
          (loans || [])
            .filter((l) => l?.createdAt && new Date(l.createdAt) > start)
            .reduce((s, l) => s + _safeNum(l.principal, 0), 0),
      },
      ratios: {
        grossMargin: totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0,
        netMargin: totalRevenue > 0 ? (netIncome / totalRevenue) * 100 : 0,
        dscr,
        dscrDebtService: dscrMeta.debtService,
        dscrStatus: dscrMeta.status,
        dscrExplanation: dscrMeta.explanation,
      },
      period: { start, end },
      taxPolicy: {
        source: financeSettings.source,
        companyIncomeTaxPercentage: financeSettings.companyIncomeTaxPercentage,
        vatPercentage: financeSettings.vatPercentage,
        withholdingTaxPercentage: financeSettings.withholdingTaxPercentage,
        applyCompanyIncomeTaxProvision: financeSettings.applyCompanyIncomeTaxProvision,
        note: 'Configure rates in Business Setup → Finance & Tax Settings. Tax provision is a management-account provision, not a tax filing.',
      },
      reportingScope: { value: reportingScope, label: reportingScopeLabel(reportingScope), includePOSRevenue, includeDeliveryRevenue },
      branch: {
        branchId: branchKey,
        note: branchKey ? 'Filtered by branchId/serviceZoneId tolerant match' : 'All branches combined',
      },
      gl: {
        enabled: _glEnabled(),
        sourceMode: sourceMode === 'operational' ? 'operational' : 'operational-fallback',
        completeness: glPostingBacklog,
        fallbackReason: sourceMode === 'operational'
          ? 'Operational mode selected by user.'
          : glPostingBacklog && !glPostingBacklog.complete
            ? 'Auto mode avoided partial GL because selected-period source documents are still unposted/failed.'
            : 'No meaningful GL statement activity found for the selected period/branch.',
      },
      reportingPolicy: buildReportingPolicyMeta({
        sourceMode,
        resolvedSourceMode: sourceMode === 'operational' ? 'operational' : 'operational-fallback',
        period,
        reportingScope,
        start,
        end,
        branchKey,
        glCompleteness: glPostingBacklog,
        fallbackReason: sourceMode === 'operational'
          ? 'Operational mode selected by user.'
          : glPostingBacklog && !glPostingBacklog.complete
            ? 'Auto mode avoided partial GL because selected-period source documents are still unposted/failed.'
            : 'No meaningful GL statement activity found for the selected period/branch.',
      }),
      reconciliation: {
        appDeliveryOrdersOutsideScope: {
          recognizedRevenue: excludedDeliveryRecognized,
          invoicedRevenue: excludedDeliveryInvoiced,
          unpaidDelivered: excludedDeliveryUnpaidDelivered,
          deliveredOrderCount: Array.isArray(ordersDeliveredInPeriod) ? ordersDeliveredInPeriod.length : 0,
          note: includeDeliveryRevenue ? 'App delivery orders are included by selected reporting scope.' : 'App delivery orders are detected but excluded from default migrated POS reporting to avoid double counting daily close revenue.',
        },
        stockMovementCogs: cogsFromMovements,
      },
      debug: {
        delivery: {
          deliveredOrdersInPeriod: Array.isArray(ordersDeliveredInPeriod) ? ordersDeliveredInPeriod.length : 0,
          includedInStatements: includeDeliveryRevenue,
          recognizedRevenue: revenueDeliveryRecognized,
          invoicedRevenue: revenueDeliveryInvoiced,
          unpaidDelivered: revenueDeliveryUnpaidDelivered,
          excludedRecognizedRevenue: excludedDeliveryRecognized,
          excludedInvoicedRevenue: excludedDeliveryInvoiced,
          excludedUnpaidDelivered: excludedDeliveryUnpaidDelivered,
        },
        pos: {
          approvedDailySummariesInPeriod: Array.isArray(posSummariesApproved) ? posSummariesApproved.length : 0,
          posRevenue: revenuePOS,
        },
        expenses: {
          expenseTxCount: Array.isArray(expensesInPeriod) ? expensesInPeriod.length : 0,
          expenseSource: expenseBreakdown.source,
        },
      },
    };

    return res.status(200).json(responseData);
  } catch (error) {
    logger.error(`[FINANCIALS] Error generating statements: ${error.message}`, error);
    return next(new HttpError(500, 'Financial generation failed'));
  }
};

/**
 * @desc    Export Data to CSV/Excel for External Auditors/Banks
 * @route   GET /api/v2/financials/export
 *
 * Supports: branchId/serviceZoneId filters
 *
 * ACCURACY FIXES:
 *  - Sales export uses orderDate (fallback createdAt only when orderDate missing)
 *  - Expenses export uses date (NOT createdAt)
 *  - POS export uses DailySummary.date (NOT createdAt)
 */
const exportData = async (req, res, next) => {
  try {
    const { type, start, end, format, branchId, serviceZoneId } = req.query;
    const branchKey = branchId || serviceZoneId || null;
    const branchMatch = buildBranchOrZoneMatch(branchKey);

    let data = [];
    let filename = 'report';

    const s = start ? new Date(start) : null;
    const e = end ? new Date(end) : null;

    if (!s || !e || Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) {
      throw new HttpError(400, 'Invalid start/end date supplied.');
    }

    // inclusive end-of-day
    e.setHours(23, 59, 59, 999);

    if (type === 'sales') {
      const orders = await Order.find({
        ...branchMatch,
        ..._ordersDeliveryGuard(),
        $or: [
          { orderDate: { $gte: s, $lte: e } },
          { orderDate: { $exists: false }, createdAt: { $gte: s, $lte: e } },
        ],
      }).lean();

      data = orders.map((o) => {
        const dt = o.orderDate || o.createdAt || new Date();
        const st = String(o.status || '').toLowerCase();
        const delivered = st === 'delivered';

        return {
          Date: new Date(dt).toISOString().split('T')[0],
          OrderID: o.id || o._id,
          Customer: o.recipientName || '',
          Amount: _safeNum(o.grandTotal, 0),
          Status: o.status || '',
          Payment: o.paymentMethod || '',
          PaymentStatus: o.paymentStatus || '',
          RecognizedRevenue: delivered && _isPaid(o.paymentStatus) ? _safeNum(o.grandTotal, 0) : 0,
          ReceivableIfUnpaidDelivered: delivered && !_isPaid(o.paymentStatus) ? _safeNum(o.grandTotal, 0) : 0,
          BranchId: o.branchId || o.serviceZoneId || o.zoneId || o.plantId || '',
        };
      });

      filename = 'sales_ledger';
    } else if (type === 'financials') {
      // ✅ EXPENSES: business date
      const expenses = await ExpenseTransaction.find({ ...branchMatch, date: { $gte: s, $lte: e } }).lean();

      const expenseRows = (expenses || []).map((x) => ({
        Date: (x.date ? new Date(x.date) : new Date()).toISOString().split('T')[0],
        Type: 'Expense',
        Category: x.category || x.type || '',
        Description: x.description || '',
        Debit: _safeNum(x.amount, 0),
        Credit: 0,
        BranchId: x.branchId || x.serviceZoneId || x.zoneId || x.plantId || '',
      }));

      // ✅ POS: business date
      const posSummaries = await DailySummary.find({
        ...branchMatch,
        status: 'approved',
        date: { $gte: s, $lte: e },
      }).lean();

      const posRows = (posSummaries || []).map((d) => ({
        Date: (d.date ? new Date(d.date) : new Date()).toISOString().split('T')[0],
        Type: 'POS',
        Category: 'DailySummary.sales.totalRevenue',
        Description: `POS sales (${d.cashierName || 'Cashier'})`,
        Debit: 0,
        Credit: _safeNum(d?.sales?.totalRevenue, 0),
        BranchId: d.branchId || d.serviceZoneId || d.zoneId || d.plantId || '',
      }));

      let walletRows = [];
      if (WalletTransaction) {
        const w = await WalletTransaction.find({
          ...branchMatch,
          $or: [{ date: { $gte: s, $lte: e } }, { createdAt: { $gte: s, $lte: e } }],
        }).lean();

        walletRows = (w || []).map((t) => {
          const direction = String(t.direction || '').toUpperCase();
          const typeU = String(t.type || '').toUpperCase();

          // ledger-style
          const isDebitLedger = direction === 'DEBIT';
          const isCreditLedger = direction === 'CREDIT';

          // wallet-style (proxy)
          const isCreditWallet = ['DEPOSIT', 'ADJUSTMENT_CREDIT'].includes(typeU);
          const isDebitWallet = ['WITHDRAWAL', 'REFUND', 'ADJUSTMENT_DEBIT', 'FEE'].includes(typeU);

          const isDebit = isDebitLedger || (!direction && isDebitWallet);
          const isCredit = isCreditLedger || (!direction && isCreditWallet);

          const dt = t.date || t.createdAt || new Date();

          return {
            Date: new Date(dt).toISOString().split('T')[0],
            Type: 'Wallet',
            Category: t.direction || t.type || '',
            Description: t.narration || t.referenceType || t.description || '',
            Debit: isDebit ? _safeNum(t.amount, 0) : 0,
            Credit: isCredit ? _safeNum(t.amount, 0) : 0,
            BranchId: t.branchId || t.serviceZoneId || t.zoneId || t.plantId || '',
          };
        });
      }

      data = [...expenseRows, ...posRows, ...walletRows];
      filename = 'general_ledger';
    } else if (type === 'inventory') {
      const stock = await StockIn.find({ ...branchMatch, purchaseDate: { $gte: s, $lte: e } }).lean();

      data = (stock || []).map((b) => ({
        Date: b.purchaseDate ? new Date(b.purchaseDate).toISOString().split('T')[0] : '',
        Supplier: b.supplier || '',
        QuantityKg: _safeNum(b.quantityKg, 0),
        RemainingKg: _safeNum(b.remainingKg, 0),
        CostPerKg: _safeNum(b.costPerKg, 0),
        TotalCost: _safeNum(b.quantityKg, 0) * _safeNum(b.costPerKg, 0),
        RemainingValue: _safeNum(b.remainingKg, 0) * _safeNum(b.costPerKg, 0),
        PaymentStatus: b.paymentStatus || (typeof b.isPaid === 'boolean' ? (b.isPaid ? 'paid' : 'unpaid') : ''),
        AmountPaid: _safeNum(b.amountPaid ?? b.paidAmount, 0),
        BranchId: b.branchId || b.serviceZoneId || b.zoneId || b.plantId || '',
      }));

      filename = 'inventory_valuation';
    } else {
      throw new HttpError(400, 'Invalid export type. Use sales | financials | inventory.');
    }

    if (branchKey) filename = `${filename}_${String(branchKey).slice(0, 12)}`;

    if (format === 'csv') {
      const parser = new Parser();
      const csv = parser.parse(data);
      res.header('Content-Type', 'text/csv');
      res.attachment(`${filename}.csv`);
      return res.send(csv);
    }

    return res.json(data);
  } catch (e) {
    return next(e instanceof HttpError ? e : new HttpError(500, 'Export failed'));
  }
};

/**
 * Revenue assurance report
 * - Uses StockIn batches and DELIVERY Orders between batches
 * - Supports branchId/serviceZoneId filter
 *
 * ACCURACY FIX:
 * - Orders date uses orderDate (fallback createdAt only when orderDate missing)
 * - Recognize revenue only when paid (to align with financial statements)
 */


const getMigrationReconciliationReport = async (req, res, next) => {
  try {
    const { period, startDate: qStart, endDate: qEnd, branchId, serviceZoneId } = req.query;
    const branchKey = branchId || serviceZoneId || null;
    const reportingScope = normalizeReportingScope(req.query.reportingScope || req.query.revenueScope || req.query.scope);
    const { start, end } = getDateRange(period || 'allMigrated', qStart, qEnd);
    const branchMatch = buildBranchOrZoneMatch(branchKey);

    const sourceMatch = { businessDate: { $gte: start, $lte: end }, importStatus: 'IMPORTED' };
    if (branchKey) {
      const vals = _splitBranchValues(branchKey);
      sourceMatch.$or = [
        { branchCode: { $in: vals } },
        { branchName: { $in: vals } },
      ];
      const ids = vals.filter((v) => mongoose.Types.ObjectId.isValid(String(v))).map((v) => new mongoose.Types.ObjectId(String(v)));
      if (ids.length) sourceMatch.$or.push({ branchObjectId: { $in: ids } });
    }

    const [sourceRows, dailySummaries, expenses, stockIns, stockMovements, glRows, ordersDelivered] = await Promise.all([
      MigrationStagingRecord
        ? MigrationStagingRecord.find(sourceMatch).select('recordType normalized importStatus importedModel importedId duplicateKey businessDate branchCode branchName sourceSheet sourceRowNumber batchId createdAt').lean().catch(() => [])
        : Promise.resolve([]),
      DailySummary.find(_andQuery(branchMatch, { date: { $gte: start, $lte: end }, status: { $in: ['approved', 'posted', 'closed'] } })).lean(),
      ExpenseTransaction.find(_andQuery(branchMatch, { date: { $gte: start, $lte: end } })).lean(),
      StockIn.find(_andQuery(branchMatch, { purchaseDate: { $gte: start, $lte: end } })).lean(),
      StockMovement.find(_andQuery(branchMatch, { movementDate: { $gte: start, $lte: end } })).lean(),
      _glEnabled()
        ? (() => {
            const glMatch = _andQuery({ status: 'POSTED', date: { $gte: start, $lte: end } }, branchKey ? { branchKey: _branchKeyMatch(branchKey) } : {});
            const scopedSourceTypes = getGLPeriodSourceTypesForScope(reportingScope);
            if (Array.isArray(scopedSourceTypes) && scopedSourceTypes.length) glMatch.sourceType = { $in: scopedSourceTypes.map(String) };
            return GeneralLedgerEntry.aggregate([
              { $match: glMatch },
              { $unwind: '$lines' },
              { $group: { _id: '$lines.accountCode', debit: { $sum: '$lines.debit' }, credit: { $sum: '$lines.credit' } } },
            ]).catch(() => []);
          })()
        : Promise.resolve([]),
      Order.find(_andQuery(
        branchMatch,
        _ordersDeliveryGuard(),
        { status: 'Delivered' },
        { $or: [{ orderDate: { $gte: start, $lte: end } }, { orderDate: { $exists: false }, createdAt: { $gte: start, $lte: end } }] }
      )).select('grandTotal paymentStatus items orderDate createdAt').lean().catch(() => []),
    ]);

    const rawSourceRows = Array.isArray(sourceRows) ? sourceRows : [];
    const dedupedSourceRows = [];
    const seenSourceKeys = new Set();
    let duplicateSourceRowsIgnored = 0;
    for (const row of rawSourceRows) {
      const n = row.normalized || {};
      const stableKey = row.importedModel && row.importedId
        ? `${row.recordType}|${row.importedModel}|${row.importedId}`
        : row.duplicateKey
          ? `${row.recordType}|${row.duplicateKey}`
          : `${row.recordType}|${_dateKey(row.businessDate)}|${row.branchCode || row.branchName || ''}|${row.sourceSheet || ''}|${row.sourceRowNumber || ''}|${_safeNum(n.expectedRevenue, 0)}|${_safeNum(n.amount, 0)}|${_safeNum(n.quantityKg, 0)}`;
      if (seenSourceKeys.has(stableKey)) {
        duplicateSourceRowsIgnored += 1;
        continue;
      }
      seenSourceKeys.add(stableKey);
      dedupedSourceRows.push(row);
    }
    const sourceRowsUsed = dedupedSourceRows;

    const source = {
      rowCount: sourceRowsUsed.length,
      rawRowCount: rawSourceRows.length,
      duplicatesIgnored: duplicateSourceRowsIgnored,
      basis: 'MigrationStagingRecord importStatus=IMPORTED, deduplicated by imported document or duplicate key',
      dailySalesRows: sourceRowsUsed.filter((r) => r.recordType === 'DAILY_SALE').length,
      expenseRows: sourceRowsUsed.filter((r) => r.recordType === 'EXPENSE').length,
      stockRows: sourceRowsUsed.filter((r) => ['OPENING_STOCK', 'STOCK_PURCHASE'].includes(r.recordType)).length,
      varianceRows: sourceRowsUsed.filter((r) => r.recordType === 'STOCK_VARIANCE').length,
      revenue: 0,
      kgSold: 0,
      cash: 0,
      pos: 0,
      transfer: 0,
      expenses: 0,
      stockKg: 0,
      stockCost: 0,
      varianceKg: 0,
      varianceValue: 0,
    };
    for (const r of sourceRowsUsed) {
      const n = r.normalized || {};
      if (r.recordType === 'DAILY_SALE') {
        source.revenue += _safeNum(n.expectedRevenue, 0);
        source.kgSold += _safeNum(n.totalKgSold, 0);
        source.cash += _safeNum(n.cashAmount, 0);
        source.pos += _safeNum(n.posAmount, 0);
        source.transfer += _safeNum(n.bankTransferAmount, 0) + _safeNum(n.companyAccountAmount, 0);
      } else if (r.recordType === 'EXPENSE') {
        source.expenses += _safeNum(n.amount, 0);
      } else if (['OPENING_STOCK', 'STOCK_PURCHASE'].includes(r.recordType)) {
        const kg = _safeNum(n.quantityKg, 0);
        source.stockKg += kg;
        source.stockCost += _safeNum(n.openingTotalCost, 0) || _safeNum(n.totalCost, 0) || kg * _safeNum(n.costPerKg, 0);
      } else if (r.recordType === 'STOCK_VARIANCE') {
        const kg = _safeNum(n.quantityKg, 0);
        const value = kg * _safeNum(n.estimatedCostPerKg, 0);
        source.varianceKg += String(n.direction || 'OUT').toUpperCase() === 'OUT' ? kg : -kg;
        source.varianceValue += value;
      }
    }

    const pos = calcPosSales(dailySummaries);
    const delivery = calcDeliverySales(ordersDelivered);
    const stockMovementSale = stockMovements.filter((m) => ['SALE_DEPLETION', 'ORDER_DEPLETION'].includes(String(m.movementType)) && String(m.direction).toUpperCase() === 'OUT');
    const stockMovementVariance = stockMovements.filter((m) => String(m.movementType) === 'RECONCILIATION_VARIANCE' && String(m.direction).toUpperCase() === 'OUT');
    const operational = {
      dailySummaryCount: dailySummaries.length,
      posRevenue: pos.revenue,
      posKgSold: pos.kgSold,
      expenses: (expenses || []).reduce((a, e) => a + _safeNum(e.amount, 0), 0),
      stockKg: (stockIns || []).reduce((a, st) => a + _safeNum(st.quantityKg, 0), 0),
      stockCost: (stockIns || []).reduce((a, st) => a + _safeNum(st.quantityKg, 0) * _safeNum(st.costPerKg, 0), 0),
      saleCogs: stockMovementSale.reduce((a, m) => a + _safeNum(m.totalCost, 0), 0),
      saleCogsKg: stockMovementSale.reduce((a, m) => a + _safeNum(m.quantityKg, 0), 0),
      inventoryVariance: stockMovementVariance.reduce((a, m) => a + _safeNum(m.totalCost, 0), 0),
      inventoryVarianceKg: stockMovementVariance.reduce((a, m) => a + _safeNum(m.quantityKg, 0), 0),
    };

    const glByCode = Object.fromEntries((glRows || []).map((r) => [String(r._id), { debit: _safeNum(r.debit, 0), credit: _safeNum(r.credit, 0) }]));
    const gl = {
      revenuePOS: _safeNum(glByCode['4000']?.credit, 0) - _safeNum(glByCode['4000']?.debit, 0),
      revenueDelivery: _safeNum(glByCode['4010']?.credit, 0) - _safeNum(glByCode['4010']?.debit, 0),
      cogs: _safeNum(glByCode['5000']?.debit, 0) - _safeNum(glByCode['5000']?.credit, 0),
      inventoryVariance: _safeNum(glByCode['5100']?.debit, 0) - _safeNum(glByCode['5100']?.credit, 0),
      expenses: ['6000', '6100', '6200', '6300', '6400', '6500'].reduce((sum, code) => sum + _safeNum(glByCode[code]?.debit, 0) - _safeNum(glByCode[code]?.credit, 0), 0),
      cash: _safeNum(glByCode['1000']?.debit, 0) - _safeNum(glByCode['1000']?.credit, 0),
      transfer: _safeNum(glByCode['1010']?.debit, 0) - _safeNum(glByCode['1010']?.credit, 0),
      posBank: _safeNum(glByCode['1020']?.debit, 0) - _safeNum(glByCode['1020']?.credit, 0),
      inventory: _safeNum(glByCode['1200']?.debit, 0) - _safeNum(glByCode['1200']?.credit, 0),
    };

    const appOrders = {
      deliveredCount: ordersDelivered.length,
      recognizedRevenue: delivery.recognizedRevenue,
      invoicedRevenue: delivery.invoicedRevenue,
      unpaidDelivered: delivery.unpaidDelivered,
      kgSold: delivery.kgSold,
      includedBySelectedScope: scopeIncludesDelivery(reportingScope),
    };

    res.status(200).json({
      ok: true,
      period: { start, end },
      branch: { branchId: branchKey, note: branchKey ? 'Branch filtered where aliases matched.' : 'All branches combined.' },
      reportingScope: { value: reportingScope, label: reportingScopeLabel(reportingScope) },
      source,
      operational,
      gl,
      appOrders,
      differences: {
        operationalVsSourceRevenue: operational.posRevenue - source.revenue,
        glVsOperationalPOSRevenue: gl.revenuePOS - operational.posRevenue,
        glVsOperationalCogs: gl.cogs - operational.saleCogs,
        glVsOperationalInventoryVariance: gl.inventoryVariance - operational.inventoryVariance,
        glVsOperationalExpenses: gl.expenses - operational.expenses,
        appOrderRevenueOutsideMigration: scopeIncludesDelivery(reportingScope) ? 0 : appOrders.recognizedRevenue,
      },
      recommendations: [
        'For historical migrated reporting, use Migrated POS / DailySummary only unless app orders are explicitly standalone and not already in the daily close.',
        'For migrated POS reporting, GL COGS comes from OPENING_STOCK/STOCK_IN journals under the STOCK_PURCHASE_FULL_COST policy. If P&L COGS is zero but the Trial Balance has account 5000, deploy the Financial Statements source-type fix and refresh.',
        'Stock variance rows must remain posted to account 5100 and reclassified against 1030 Cash Over/Short; they must not credit 1200 Inventory again.',
      ],
    });
  } catch (error) {
    next(error);
  }
};

const getRevenueAssuranceReport = async (req, res, next) => {
  try {
    const { branchId, serviceZoneId } = req.query;
    const branchKey = branchId || serviceZoneId || null;
    const branchMatch = buildBranchOrZoneMatch(branchKey);

    const batches = await StockIn.find({ ...branchMatch }).sort({ purchaseDate: -1 }).limit(20).lean();

    const report = await Promise.all(
      (batches || []).map(async (batch) => {
        const nextBatch = await StockIn.findOne({
          ...branchMatch,
          purchaseDate: { $gt: batch.purchaseDate },
        }).sort({ purchaseDate: 1 });

        const endDate = nextBatch ? nextBatch.purchaseDate : new Date();

        const sales = await Order.aggregate([
          {
            $match: {
              ...branchMatch,
              ..._ordersDeliveryGuard(),
              status: 'Delivered',
              $or: [
                { orderDate: { $gte: new Date(batch.purchaseDate), $lt: new Date(endDate) } },
                {
                  orderDate: { $exists: false },
                  createdAt: { $gte: new Date(batch.purchaseDate), $lt: new Date(endDate) },
                },
              ],
            },
          },
          {
            $group: {
              _id: null,
              totalInvoiced: { $sum: '$grandTotal' },
              totalRecognized: {
                $sum: {
                  $cond: [
                    {
                      $in: [
                        { $toLower: { $ifNull: ['$paymentStatus', ''] } },
                        ['completed', 'paid', 'success', 'successful'],
                      ],
                    },
                    '$grandTotal',
                    0,
                  ],
                },
              },
              count: { $sum: 1 },
            },
          },
        ]);

        const actualInvoicedRevenue = _safeNum(sales[0]?.totalInvoiced, 0);
        const actualRecognizedRevenue = _safeNum(sales[0]?.totalRecognized, 0);

        const expectedRevenue = _safeNum(batch.quantityKg, 0) * _safeNum(batch.targetSalePricePerKg, 0);
        const discrepancy = actualRecognizedRevenue - expectedRevenue;

        const integrityScore =
          expectedRevenue > 0 ? Math.max(0, 100 - (Math.abs(discrepancy) / expectedRevenue) * 100) : 0;

        return {
          branchId: batch.branchId || branchKey || null,
          batchId: batch._id,
          date: batch.purchaseDate,
          supplier: batch.supplier,
          quantityKg: _safeNum(batch.quantityKg, 0),
          expectedRevenue,
          actualInvoicedRevenue,
          actualRecognizedRevenue,
          discrepancyRecognizedVsExpected: discrepancy,
          integrityScore: Math.round(integrityScore),
          progress: 100,
        };
      })
    );

    return res.status(200).json(report);
  } catch (e) {
    return next(e);
  }
};

/**
 * Tax compliance report (data-driven)
 * - Supports branchId/serviceZoneId filter
 *
 * ACCURACY FIX:
 * - Orders use orderDate (fallback createdAt only when orderDate missing)
 * - POS uses DailySummary.date (NOT createdAt)
 * - Expenses use business date
 * - Delivery revenue uses recognized (paid) to align with financial statements
 */
const getTaxComplianceReport = async (req, res, next) => {
  try {
    const { branchId, serviceZoneId } = req.query;
    const sourceMode = normalizeSourceMode(req.query.sourceMode || req.query.source || 'auto');
    const branchKey = branchId || serviceZoneId || null;
    const branchMatch = buildBranchOrZoneMatch(branchKey);

    const { start, end } = getDateRange('yearly');

    // GL-first tax mode: if posted journals exist, compute taxable revenue and expenses from GL.
    if (_glEnabled() && sourceMode !== 'operational') {
      const hasAny = await _glHasAnyEntries({ end, branchKey });
      if (hasAny) {
        const coaMap = await _loadCOAMap();
        const rows = await _glAggregateAccountSums({ start, end, branchKey, mode: 'period' });
        const aggMap = _mapAggRowsToMap(rows);
        const posRevenue = _asPositiveForType('INCOME', _getSignedBal(coaMap, aggMap, '4000'));
        const deliveryRevenue = _asPositiveForType('INCOME', _getSignedBal(coaMap, aggMap, '4010'));
        const taxableRevenue = posRevenue + deliveryRevenue;
        const totalExpenses = ['6000', '6100', '6200', '6300', '6400', '6500']
          .reduce((sum, code) => sum + _asPositiveForType('EXPENSE', _getSignedBal(coaMap, aggMap, code)), 0);
        const financeSettings = await getFinanceSettings();
        const vatRate = _safeNum(financeSettings.vatPercentage, 7.5) / 100;
        const vatPayable = taxableRevenue * vatRate;
        return res.status(200).json({
          branchId: branchKey,
          taxableRevenue,
          vatPayable,
          vatRatePercentage: _safeNum(financeSettings.vatPercentage, 7.5),
          taxSettingsSource: financeSettings.source,
          totalExpenses,
          withholdingTaxPayable: 0,
          levyPayable: 0,
          citStatus: 'Review with tax advisor',
          filingDueDate: 'Configure in tax calendar',
          period: { start, end },
          gl: { enabled: true, source: 'GeneralLedgerEntry', posRevenue, deliveryRevenue },
          notes: [
            'Tax report generated from posted GL journals.',
            `VAT shown at ${_safeNum(financeSettings.vatPercentage, 7.5)}% of GL revenue accounts 4000 and 4010. Adjust in Business Setup → Finance & Tax Settings if your tax policy excludes any revenue class.`,
            'WHT, levies and CIT require dedicated tax configuration or manual journals.'
          ],
        });
      }
    }

    const [ordersDeliveredYear, posSummariesApproved, expensesYear] = await Promise.all([
      Order.find({
        ...branchMatch,
        ..._ordersDeliveryGuard(),
        status: 'Delivered',
        $or: [
          { orderDate: { $gte: start, $lte: end } },
          { orderDate: { $exists: false }, createdAt: { $gte: start, $lte: end } },
        ],
      })
        .select('grandTotal paymentStatus orderDate createdAt status')
        .lean(),

      // ✅ POS: strictly by date
      DailySummary.find({
        ...branchMatch,
        status: 'approved',
        date: { $gte: start, $lte: end },
      }).lean(),

      ExpenseTransaction.find({
        ...branchMatch,
        date: { $gte: start, $lte: end },
      }).lean(),
    ]);

    const deliveryRecognized = (ordersDeliveredYear || []).reduce((sum, o) => {
      const delivered = String(o.status || '').toLowerCase() === 'delivered';
      return sum + (delivered && _isPaid(o.paymentStatus) ? _safeNum(o.grandTotal, 0) : 0);
    }, 0);

    const posRev = (posSummariesApproved || []).reduce((sum, s) => sum + _safeNum(s?.sales?.totalRevenue, 0), 0);
    const totalRevenue = deliveryRecognized + posRev;

    const totalExpenses = (expensesYear || []).reduce((sum, e) => sum + _safeNum(e.amount, 0), 0);

    const financeSettings = await getFinanceSettings();
    const vatRate = _safeNum(financeSettings.vatPercentage, 7.5) / 100;
    // VAT uses configurable rate — adjust if you treat POS/delivery differently
    const vatPayable = totalRevenue * vatRate;

    return res.status(200).json({
      branchId: branchKey,
      taxableRevenue: totalRevenue,
      vatPayable,
      vatRatePercentage: _safeNum(financeSettings.vatPercentage, 7.5),
      taxSettingsSource: financeSettings.source,
      totalExpenses,
      citStatus: 'Review with tax advisor',
      filingDueDate: 'Configure in tax calendar',
      period: { start, end },
      notes: [
        'Delivery revenue used here is recognized (paid) to align with Management Accounts.',
        'POS is sourced from approved DailySummary records filtered by DailySummary.date (business date), not createdAt.',
        'Expenses are filtered by ExpenseTransaction.date (business date), not createdAt.',
        'If VAT should be computed on invoiced deliveries (paid+unpaid), switch to summing all delivered grandTotal.',
      ],
    });
  } catch (e) {
    return next(e);
  }
};



const CASH_ACCOUNT_LABELS = Object.freeze({
  '1000': 'Cash on Hand',
  '1010': 'Bank - Transfers',
  '1020': 'Bank - POS Settlements',
});

const REVENUE_CODES = ['4000', '4010'];
const COGS_CODES = ['5000', '5100'];
const OPEX_CODES = ['6000', '6100', '6200', '6300', '6400', '6500'];

const _journalLineRows = (journals = []) => {
  const rows = [];
  for (const j of journals || []) {
    for (const l of j.lines || []) {
      rows.push({
        journalId: String(j._id || ''),
        date: j.date,
        periodKey: j.periodKey,
        branchKey: j.branchKey || null,
        sourceType: j.sourceType || null,
        sourceId: j.sourceId || null,
        entryType: j.entryType || null,
        narration: l.narration || j.narration || '',
        accountCode: l.accountCode,
        debit: _safeNum(l.debit, 0),
        credit: _safeNum(l.credit, 0),
        netMovement: _safeNum(l.debit, 0) - _safeNum(l.credit, 0),
        status: j.status,
        sourceTrace: {
          journalId: String(j._id || ''),
          sourceType: j.sourceType || null,
          sourceId: j.sourceId || null,
          endpoint: j.sourceId ? `/api/v2/financials/source-trace?sourceType=${encodeURIComponent(j.sourceType || '')}&sourceId=${encodeURIComponent(j.sourceId || '')}` : null,
        },
      });
    }
  }
  return rows;
};

const _summarizeGLForPL = (lineRows = []) => {
  const sumCodes = (codes, normal = 'CREDIT') => {
    const debit = lineRows.filter((r) => codes.includes(String(r.accountCode))).reduce((acc, r) => acc + _safeNum(r.debit, 0), 0);
    const credit = lineRows.filter((r) => codes.includes(String(r.accountCode))).reduce((acc, r) => acc + _safeNum(r.credit, 0), 0);
    return normal === 'CREDIT' ? credit - debit : debit - credit;
  };
  const revenue = Math.max(0, sumCodes(REVENUE_CODES, 'CREDIT'));
  const cogs = Math.max(0, sumCodes(COGS_CODES, 'DEBIT'));
  const opex = Math.max(0, sumCodes(OPEX_CODES, 'DEBIT'));
  return {
    revenue,
    cogs,
    grossProfit: revenue - cogs,
    opex,
    netProfit: revenue - cogs - opex,
  };
};

const _resolveSourceDocument = async ({ sourceType, sourceId }) => {
  if (!sourceType || !sourceId) return null;
  const id = String(sourceId);
  const objectId = mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;
  const sourceTypeNorm = String(sourceType).toUpperCase();
  const byObjectIdOrBusinessId = objectId ? { $or: [{ _id: objectId }, { dailySummaryId: id }, { id }] } : { $or: [{ dailySummaryId: id }, { id }] };

  if (sourceTypeNorm === 'DAILY_SUMMARY') {
    return DailySummary.findOne(byObjectIdOrBusinessId).select('_id dailySummaryId date branchId cashierName status sales expenses reconciliation settlement posting managerApproval createdAt updatedAt').lean();
  }
  if (sourceTypeNorm === 'EXPENSE') {
    return ExpenseTransaction.findOne(objectId ? { _id: objectId } : { _id: id }).select('_id date branchId cashierName category paymentDisposition description amount status posting voiding createdAt updatedAt').lean();
  }
  if (sourceTypeNorm === 'ORDER') {
    return Order.findOne(objectId ? { $or: [{ _id: objectId }, { id }] } : { id }).select('_id id orderDate createdAt branchId serviceZoneId plantId status paymentStatus paymentMethod grandTotal finalAmountPaid walletAmountUsed items posting deliveryAddressSnapshot').lean();
  }
  if (sourceTypeNorm === 'STOCK_IN') {
    return StockIn.findOne(objectId ? { _id: objectId } : { _id: id }).select('_id purchaseDate branchId supplier quantityKg remainingKg costPerKg targetSalePricePerKg paymentStatus amountPaid posting createdAt updatedAt').lean();
  }
  return null;
};

const _walletTypeDirection = (typeRaw) => {
  const type = String(typeRaw || '').toUpperCase();
  if (['DEPOSIT', 'REFUND_TO_WALLET', 'REFERRAL_BONUS', 'ADMIN_CREDIT', 'ADJUSTMENT_CREDIT'].includes(type)) return 'CREDIT';
  if (['ORDER_PAYMENT', 'WITHDRAWAL', 'ADMIN_DEBIT', 'FEE', 'ADJUSTMENT_DEBIT'].includes(type)) return 'DEBIT';
  return 'UNKNOWN';
};

const _getWalletRows = async ({ start, end, limit = 250 } = {}) => {
  if (!WalletTransaction) return [];
  const match = { createdAt: { $lte: end }, status: { $in: ['COMPLETED', 'Completed', 'completed'] } };
  if (start) match.createdAt.$gte = start;
  return WalletTransaction.find(match).sort({ createdAt: -1 }).limit(limit).lean();
};

const getCashMovementReport = async (req, res, next) => {
  try {
    const branchKey = req.query.branchId || req.query.serviceZoneId || null;
    const { start, end } = getDateRange(req.query.period || 'custom', req.query.startDate, req.query.endDate);
    const cashAccounts = Object.keys(CASH_ACCOUNT_LABELS);

    if (!GeneralLedgerEntry) {
      return res.json({
        ok: true,
        mode: 'NO_GL_MODEL',
        period: { start, end },
        branchId: branchKey,
        accounts: [],
        rows: [],
        totalNetMovement: 0,
        noDataState: {
          title: 'GL cash movement is not available yet',
          message: 'The GeneralLedgerEntry model is unavailable, so cash movement cannot be computed from posted journals.',
          recommendedAction: 'Enable the GL model and post approved source records before using this report.',
        },
      });
    }

    const match = { status: 'POSTED', date: { $gte: start, $lte: end }, 'lines.accountCode': { $in: cashAccounts } };
    if (branchKey) match.branchKey = String(branchKey);

    const journals = await GeneralLedgerEntry.find(match)
      .select('_id date periodKey branchKey sourceType sourceId entryType narration status lines totals createdAt')
      .sort({ date: -1, createdAt: -1 })
      .limit(Math.min(Number(req.query.limit || 250), 1000))
      .lean();

    const lineRows = _journalLineRows(journals).filter((r) => cashAccounts.includes(String(r.accountCode)));
    const byAccount = new Map();
    for (const row of lineRows) {
      const key = String(row.accountCode);
      const acc = byAccount.get(key) || { accountCode: key, accountName: CASH_ACCOUNT_LABELS[key] || key, debit: 0, credit: 0, netMovement: 0, journalLineCount: 0 };
      acc.debit += row.debit;
      acc.credit += row.credit;
      acc.netMovement += row.netMovement;
      acc.journalLineCount += 1;
      byAccount.set(key, acc);
    }
    const accounts = [...byAccount.values()].sort((a, b) => String(a.accountCode).localeCompare(String(b.accountCode)));
    return res.json({
      ok: true,
      mode: 'GL',
      period: { start, end },
      branchId: branchKey,
      accounts,
      rows: lineRows,
      totalNetMovement: accounts.reduce((sum, x) => sum + _safeNum(x.netMovement, 0), 0),
      noDataState: lineRows.length ? null : {
        title: 'No posted cash movement found',
        message: 'There are no posted GL lines for cash, bank transfer or POS settlement accounts in the selected period.',
        recommendedAction: 'Confirm that approved days/orders/expenses have been posted to GL and that the selected branch/date filter is correct.',
      },
      guide: {
        debitMeaning: 'Debit to cash/bank increases cash or settlement balance.',
        creditMeaning: 'Credit to cash/bank reduces cash or settlement balance, for example expenses, reversals or transfers out.',
        sourceTrace: 'Use each row sourceTrace to inspect the journal and originating document.',
      },
    });
  } catch (e) { return next(e); }
};

const getExpenseAnalysisReport = async (req, res, next) => {
  try {
    const branchKey = req.query.branchId || req.query.serviceZoneId || null;
    const { start, end } = getDateRange(req.query.period || 'custom', req.query.startDate, req.query.endDate);
    const q = { date: { $gte: start, $lte: end }, 'voiding.isVoided': { $ne: true } };
    if (branchKey) Object.assign(q, buildBranchOrZoneMatch(branchKey));

    const [categoryRows, paymentRows, dailyRows, details] = await Promise.all([
      ExpenseTransaction.aggregate([{ $match: q }, { $group: { _id: '$category', amount: { $sum: '$amount' }, count: { $sum: 1 } } }, { $sort: { amount: -1 } }]),
      ExpenseTransaction.aggregate([{ $match: q }, { $group: { _id: '$paymentDisposition', amount: { $sum: '$amount' }, count: { $sum: 1 } } }, { $sort: { amount: -1 } }]),
      ExpenseTransaction.aggregate([{ $match: q }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } }, amount: { $sum: '$amount' }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
      ExpenseTransaction.find(q).select('_id date branchId cashierName category paymentDisposition description amount status posting voiding createdAt').sort({ date: -1, createdAt: -1 }).limit(Math.min(Number(req.query.limit || 250), 1000)).lean(),
    ]);

    const total = categoryRows.reduce((s, r) => s + _safeNum(r.amount, 0), 0);
    return res.json({
      ok: true,
      period: { start, end },
      branchId: branchKey,
      total,
      rows: categoryRows.map((r) => ({ category: r._id || 'UNCATEGORIZED', amount: _safeNum(r.amount, 0), count: r.count })),
      byPaymentDisposition: paymentRows.map((r) => ({ paymentDisposition: r._id || 'UNSPECIFIED', amount: _safeNum(r.amount, 0), count: r.count })),
      dailyTrend: dailyRows.map((r) => ({ date: r._id, amount: _safeNum(r.amount, 0), count: r.count })),
      details: details.map((x) => ({
        id: x._id,
        date: x.date,
        branchId: x.branchId,
        cashierName: x.cashierName,
        category: x.category,
        paymentDisposition: x.paymentDisposition,
        description: x.description,
        amount: _safeNum(x.amount, 0),
        status: x.status,
        postingStatus: x.posting?.status || 'UNPOSTED',
        glEntryIds: x.posting?.glEntryIds || [],
      })),
      noDataState: total > 0 ? null : {
        title: 'No expenses found',
        message: 'No non-voided expense transactions were found for the selected period and branch.',
        recommendedAction: 'Check the date/branch filter or confirm that cashier expenses were logged with the correct business date.',
      },
      guide: {
        source: 'ExpenseTransaction.date is used as the business date. Voided expenses are excluded.',
        cashImpact: 'CASH expenses reduce expected cash on hand. TRANSFER/POS/UNPAID expenses should be reviewed separately by Finance.',
      },
    });
  } catch (e) { return next(e); }
};

const getBranchProfitLossReport = async (req, res, next) => {
  try {
    const branchKey = req.query.branchId || req.query.serviceZoneId || null;
    const { start, end } = getDateRange(req.query.period || 'custom', req.query.startDate, req.query.endDate);
    if (!GeneralLedgerEntry) throw new HttpError(501, 'GL model is not available');
    const match = { status: 'POSTED', date: { $gte: start, $lte: end } };
    if (branchKey) match.branchKey = String(branchKey);
    const journals = await GeneralLedgerEntry.find(match).select('_id date branchKey sourceType sourceId narration status lines').lean();
    const rowsByBranch = new Map();
    for (const row of _journalLineRows(journals)) {
      const key = String(row.branchKey || 'UNASSIGNED');
      const arr = rowsByBranch.get(key) || [];
      arr.push(row);
      rowsByBranch.set(key, arr);
    }
    const branchIds = [...rowsByBranch.keys()].filter((x) => mongoose.Types.ObjectId.isValid(x));
    const plants = branchIds.length ? await Plant.find({ _id: { $in: branchIds.map((x) => new mongoose.Types.ObjectId(x)) } }).select('_id name code').lean() : [];
    const plantMap = new Map(plants.map((p) => [String(p._id), p]));
    const rows = [...rowsByBranch.entries()].map(([key, lineRows]) => {
      const pl = _summarizeGLForPL(lineRows);
      const plant = plantMap.get(key);
      return {
        branchId: key === 'UNASSIGNED' ? null : key,
        branchName: plant?.name || (key === 'UNASSIGNED' ? 'Unassigned / No branch' : key),
        revenue: pl.revenue,
        cogs: pl.cogs,
        grossProfit: pl.grossProfit,
        opex: pl.opex,
        netProfit: pl.netProfit,
        grossMargin: pl.revenue > 0 ? (pl.grossProfit / pl.revenue) * 100 : 0,
        netMargin: pl.revenue > 0 ? (pl.netProfit / pl.revenue) * 100 : 0,
        journalLineCount: lineRows.length,
      };
    }).sort((a, b) => b.netProfit - a.netProfit);
    const totals = rows.reduce((acc, r) => {
      acc.revenue += r.revenue; acc.cogs += r.cogs; acc.grossProfit += r.grossProfit; acc.opex += r.opex; acc.netProfit += r.netProfit; return acc;
    }, { revenue: 0, cogs: 0, grossProfit: 0, opex: 0, netProfit: 0 });
    return res.json({
      ok: true,
      mode: 'GL',
      period: { start, end },
      branchId: branchKey,
      rows,
      totals,
      noDataState: rows.length ? null : {
        title: 'No branch P&L data found',
        message: 'There are no posted GL lines for revenue, COGS or OPEX in the selected period.',
        recommendedAction: 'Post approved daily summaries, expenses, stock-in and delivered orders to GL before using branch P&L.',
      },
      guide: {
        revenueAccounts: REVENUE_CODES,
        cogsAccounts: COGS_CODES,
        opexAccounts: OPEX_CODES,
        note: 'Branch P&L is computed from posted GL journals by branchKey. Unassigned journals should be corrected at source or reposted with a branch.',
      },
    });
  } catch (e) { return next(e); }
};

const getSourceTraceReport = async (req, res, next) => {
  try {
    if (!GeneralLedgerEntry) throw new HttpError(501, 'GL model is not available');
    const { journalId, sourceType, sourceId } = req.query;
    let journalQuery = {};
    if (journalId) {
      if (!mongoose.Types.ObjectId.isValid(String(journalId))) throw new HttpError(400, 'journalId must be a valid ObjectId');
      journalQuery = { _id: new mongoose.Types.ObjectId(String(journalId)) };
    } else if (sourceType && sourceId) {
      journalQuery = { sourceType: String(sourceType).toUpperCase(), sourceId: String(sourceId) };
    } else {
      throw new HttpError(400, 'Provide journalId or sourceType + sourceId');
    }
    const journals = await GeneralLedgerEntry.find(journalQuery).sort({ date: -1, createdAt: -1 }).lean();
    const source = journals[0] ? await _resolveSourceDocument({ sourceType: journals[0].sourceType, sourceId: journals[0].sourceId }) : (sourceType && sourceId ? await _resolveSourceDocument({ sourceType, sourceId }) : null);
    return res.json({
      ok: true,
      query: { journalId: journalId || null, sourceType: sourceType || null, sourceId: sourceId || null },
      journals,
      source,
      controls: {
        foundJournalCount: journals.length,
        foundSource: Boolean(source),
        balancedJournals: journals.every((j) => _safeNum(j?.totals?.diff, 0) <= 0.5),
      },
      guide: 'Source trace connects a GL journal back to the business document that created it: daily close, expense, stock-in, order or reversal.',
    });
  } catch (e) { return next(e); }
};

const getWalletLiabilityReport = async (req, res, next) => {
  try {
    const { start, end } = getDateRange(req.query.period || 'custom', req.query.startDate, req.query.endDate);
    const rows = await _getWalletRows({ start: null, end, limit: Math.min(Number(req.query.limit || 500), 1000) });
    const periodRows = rows.filter((r) => new Date(r.createdAt) >= start && new Date(r.createdAt) <= end);
    const summarize = (items) => items.reduce((acc, r) => {
      const direction = _walletTypeDirection(r.type);
      if (direction === 'CREDIT') acc.credits += _safeNum(r.amount, 0);
      else if (direction === 'DEBIT') acc.debits += _safeNum(r.amount, 0);
      else acc.unknown += _safeNum(r.amount, 0);
      acc.count += 1;
      return acc;
    }, { credits: 0, debits: 0, unknown: 0, count: 0 });
    const closing = summarize(rows);
    closing.liability = closing.credits - closing.debits;
    const period = summarize(periodRows);
    period.netMovement = period.credits - period.debits;
    return res.json({
      ok: true,
      period: { start, end },
      closingLiability: closing.liability,
      periodNetMovement: period.netMovement,
      summary: { closing, period },
      rows: periodRows.slice(0, 250).map((r) => ({ id: r.id || r._id, userId: r.userId, type: r.type, direction: _walletTypeDirection(r.type), amount: _safeNum(r.amount, 0), status: r.status, orderId: r.orderId, gatewayTransactionId: r.gatewayTransactionId, createdAt: r.createdAt, description: r.description })),
      noDataState: rows.length ? null : {
        title: 'No completed wallet transactions found',
        message: 'Wallet liability cannot be estimated because there are no completed wallet ledger records up to the selected date.',
        recommendedAction: 'Confirm wallet transactions are being recorded before relying on the liability estimate.',
      },
      guide: {
        creditTypes: ['DEPOSIT', 'REFUND_TO_WALLET', 'REFERRAL_BONUS', 'ADMIN_CREDIT'],
        debitTypes: ['ORDER_PAYMENT', 'WITHDRAWAL', 'ADMIN_DEBIT', 'FEE'],
        note: 'This report estimates wallet liability only. It does not automatically post wallet liability journals.',
      },
    });
  } catch (e) { return next(e); }
};

const getFailedPaymentReviewQueue = async (req, res, next) => {
  try {
    const branchKey = req.query.branchId || req.query.serviceZoneId || null;
    const { start, end } = getDateRange(req.query.period || 'custom', req.query.startDate, req.query.endDate);
    const q = {
      ...buildBranchOrZoneMatch(branchKey),
      $or: [
        { paymentStatus: { $in: ['Failed', 'FAILED', 'failed'] } },
        { status: { $in: ['Failed', 'Vending Failed'] } },
        { paymentVerificationDelayed: true },
      ],
      createdAt: { $gte: start, $lte: end },
    };
    const items = await Order.find(q).select('_id id customerId recipientName recipientPhone orderDate createdAt branchId serviceZoneId status paymentStatus paymentMethod paymentGateway paymentGatewayReference paymentTransactionId grandTotal finalAmountPaid walletAmountUsed posting').sort({ createdAt: -1 }).limit(Math.min(Number(req.query.limit || 250), 1000)).lean();
    const totalExposure = items.reduce((s, x) => s + _safeNum(x.grandTotal, 0), 0);
    return res.json({
      ok: true,
      period: { start, end },
      branchId: branchKey,
      totalExposure,
      count: items.length,
      items: items.map((x) => ({
        orderId: x.id || x._id,
        customerId: x.customerId,
        customer: x.recipientName,
        phone: x.recipientPhone,
        date: x.orderDate || x.createdAt,
        branchId: x.branchId || x.serviceZoneId,
        status: x.status,
        paymentStatus: x.paymentStatus,
        paymentMethod: x.paymentMethod,
        gateway: x.paymentGateway,
        reference: x.paymentGatewayReference || x.paymentTransactionId,
        amount: _safeNum(x.grandTotal, 0),
        postingStatus: x.posting?.status || 'UNPOSTED',
        recommendedAction: x.paymentVerificationDelayed ? 'Review delayed verification and contact payment ops/customer.' : 'Confirm gateway/bank outcome before retry/refund/manual completion.',
      })),
      noDataState: items.length ? null : {
        title: 'No failed payments found',
        message: 'No failed, delayed or vending-failed payment records were found in the selected period.',
        recommendedAction: 'Keep monitoring this queue daily as part of revenue assurance.',
      },
    });
  } catch (e) { return next(e); }
};

const getSettlementDashboard = async (req, res, next) => {
  try {
    const actor = _actor(req);
    const { match, start, end, branchKey } = _buildSummaryMatchForSettlement(req);

    const summaries = await DailySummary.find(match)
      .sort({ date: -1, branchId: 1 })
      .limit(Math.min(Number(req.query.limit || 250), 500))
      .lean();

    const settlementDocs = [];
    for (const summary of summaries) {
      const doc = await _ensureSettlementForSummary(summary, actor);
      settlementDocs.push(_settlementProjection(doc));
    }

    const countByStatus = settlementDocs.reduce((acc, row) => {
      const key = row?.settlementStatus || 'NOT_REVIEWED';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    const totals = settlementDocs.reduce(
      (acc, row) => {
        acc.expectedCash += _safeNum(row?.expected?.expectedCashOnHand, 0);
        acc.actualCash += row?.cash?.actualAmount === null || row?.cash?.actualAmount === undefined ? 0 : _safeNum(row?.cash?.actualAmount, 0);
        acc.cashVariance += _safeNum(row?.cash?.variance, 0);

        acc.expectedTransfer += _safeNum(row?.expected?.transferSales, 0);
        acc.actualTransfer += row?.transfer?.actualAmount === null || row?.transfer?.actualAmount === undefined ? 0 : _safeNum(row?.transfer?.actualAmount, 0);
        acc.transferVariance += _safeNum(row?.transfer?.variance, 0);

        acc.expectedPos += _safeNum(row?.expected?.posSales, 0);
        acc.actualPos += row?.pos?.actualAmount === null || row?.pos?.actualAmount === undefined ? 0 : _safeNum(row?.pos?.actualAmount, 0);
        acc.posVariance += _safeNum(row?.pos?.variance, 0);
        return acc;
      },
      {
        expectedCash: 0,
        actualCash: 0,
        cashVariance: 0,
        expectedTransfer: 0,
        actualTransfer: 0,
        transferVariance: 0,
        expectedPos: 0,
        actualPos: 0,
        posVariance: 0,
      }
    );

    return res.json({
      ok: true,
      optional: true,
      blocking: false,
      message: 'Settlement control is optional and does not block POS, approval, GL posting or financial reporting.',
      period: { start, end },
      branchId: branchKey,
      count: settlementDocs.length,
      countByStatus,
      totals,
      items: settlementDocs,
    });
  } catch (e) {
    return next(e);
  }
};

const getSettlementConfirmations = async (req, res, next) => {
  try {
    const { start, end } = getDateRange(req.query.period || 'custom', req.query.startDate, req.query.endDate);
    const branchKey = req.query.branchId || req.query.serviceZoneId || null;
    const q = { businessDate: { $gte: start, $lte: end } };
    if (branchKey) q.branchId = String(branchKey);
    if (req.query.status) q.settlementStatus = String(req.query.status);

    const items = await SettlementConfirmation.find(q)
      .sort({ businessDate: -1, createdAt: -1 })
      .limit(Math.min(Number(req.query.limit || 250), 500))
      .lean();

    return res.json({
      ok: true,
      optional: true,
      blocking: false,
      count: items.length,
      items: items.map(_settlementProjection),
    });
  } catch (e) {
    return next(e);
  }
};

const confirmSettlement = async (req, res, next) => {
  try {
    const actor = _actor(req);
    const {
      dailySummaryId,
      settlementType,
      actualAmount,
      reference,
      narration,
      terminalOrChannel,
      notes,
      varianceReason,
      status,
      businessDate,
      branchId,
    } = req.body || {};

    const method = _normalizeMethod(settlementType || req.body?.method);
    if (!method) throw new HttpError(400, 'settlementType is required. Use CASH, TRANSFER or POS.');

    let summary = null;
    if (dailySummaryId && mongoose.Types.ObjectId.isValid(String(dailySummaryId))) {
      summary = await DailySummary.findById(dailySummaryId).lean();
    }

    if (!summary && businessDate && branchId) {
      const { start, end } = _businessDateBounds(businessDate);
      summary = await DailySummary.findOne({
        ...buildBranchOrZoneMatch(branchId),
        date: { $gte: start, $lte: end },
      }).sort({ updatedAt: -1 }).lean();
    }

    if (!summary) throw new HttpError(404, 'Daily summary not found for settlement confirmation.');

    const doc = await _ensureSettlementForSummary(summary, actor);
    const expectedAmount = _safeNum(doc?.[method]?.expectedAmount, 0);
    const actual = _safeNum(actualAmount, 0);

    doc[method] = {
      ...(doc[method]?.toObject ? doc[method].toObject() : doc[method] || {}),
      expectedAmount,
      actualAmount: actual,
      variance: expectedAmount - actual,
      status: _autoStatusForMethod(expectedAmount, actual, status),
      reference: reference || null,
      narration: narration || null,
      terminalOrChannel: terminalOrChannel || null,
      varianceReason: varianceReason || null,
      notes: notes || null,
      confirmedBy: actor,
      confirmedAt: new Date(),
    };

    doc.lastReviewedBy = actor;
    doc.lastReviewedAt = new Date();
    const saved = await doc.save();

    await DailySummary.updateOne(
      { _id: summary._id },
      {
        $set: {
          'settlement.status': saved.settlementStatus,
          'settlement.confirmationId': saved._id,
          'settlement.lastReviewedAt': saved.lastReviewedAt,
          'settlement.lastReviewedBy': saved.lastReviewedBy,
          'settlement.isOptionalControl': true,
        },
      }
    );

    return res.json({
      ok: true,
      optional: true,
      blocking: false,
      message: `${method.toUpperCase()} settlement confirmation saved. This is advisory only and does not block GL posting.`,
      item: _settlementProjection(saved),
    });
  } catch (e) {
    return next(e);
  }
};

const createStatementUpload = async (req, res, next) => {
  try {
    const actor = _actor(req);
    const {
      sourceType = 'BANK',
      uploadName,
      branchId,
      periodStart,
      periodEnd,
      rawText,
      rows,
      meta,
    } = req.body || {};

    const st = String(sourceType || 'BANK').toUpperCase();
    if (!['BANK', 'POS', 'PAYSTACK', 'MONNIFY', 'OTHER'].includes(st)) {
      throw new HttpError(400, 'Invalid sourceType. Use BANK, POS, PAYSTACK, MONNIFY or OTHER.');
    }

    const parsed = _parseStatementRows(rawText, rows);
    const normalised = _normaliseStatementRows(parsed, branchId || null);
    const matchedRows = await _matchStatementRowsToSettlements({
      rows: normalised,
      sourceType: st,
      branchId: branchId || null,
      periodStart,
      periodEnd,
    });
    const summary = _statementSummary(matchedRows);

    const upload = await StatementUpload.create({
      sourceType: st,
      uploadName: uploadName || `${st} upload ${new Date().toISOString().slice(0, 10)}`,
      branchId: branchId || null,
      periodStart: _parseDateOrNull(periodStart),
      periodEnd: _parseDateOrNull(periodEnd),
      uploadedBy: actor,
      uploadedAt: new Date(),
      status: summary.duplicateReferenceCount > 0 || summary.unmatchedCount > 0 ? 'REVIEW_REQUIRED' : 'PARSED',
      rows: matchedRows,
      summary,
      rawTextSample: rawText ? String(rawText).slice(0, 2000) : null,
      meta: meta || {},
    });

    return res.status(201).json({
      ok: true,
      optional: true,
      blocking: false,
      message: 'Manual statement upload foundation saved. Matching remains advisory until automated reconciliation is enabled.',
      item: upload,
    });
  } catch (e) {
    return next(e);
  }
};

const listStatementUploads = async (req, res, next) => {
  try {
    const branchKey = req.query.branchId || req.query.serviceZoneId || null;
    const q = {};
    if (branchKey) q.branchId = String(branchKey);
    if (req.query.sourceType) q.sourceType = String(req.query.sourceType).toUpperCase();

    const items = await StatementUpload.find(q)
      .sort({ uploadedAt: -1 })
      .limit(Math.min(Number(req.query.limit || 50), 200))
      .select('-rows.raw')
      .lean();

    return res.json({ ok: true, optional: true, blocking: false, count: items.length, items });
  } catch (e) {
    return next(e);
  }
};

const getRevenueLeakageDashboard = async (req, res, next) => {
  try {
    const { start, end } = getDateRange(req.query.period || 'custom', req.query.startDate, req.query.endDate);
    const branchKey = req.query.branchId || req.query.serviceZoneId || null;
    const summaryMatch = { date: { $gte: start, $lte: end } };
    const settlementMatch = { businessDate: { $gte: start, $lte: end } };
    const saleMatch = { date: { $gte: start, $lte: end } };
    if (branchKey) {
      Object.assign(summaryMatch, buildBranchOrZoneMatch(branchKey));
      settlementMatch.branchId = String(branchKey);
      Object.assign(saleMatch, buildBranchOrZoneMatch(branchKey));
    }

    const [
      unfinalizedDays,
      pendingApprovalDays,
      approvedButUnpostedDays,
      failedPostingDays,
      rejectedCloseouts,
      settlementVariances,
      unreviewedSettlements,
      voidedSales,
      priceOverrides,
      statementAgg,
    ] = await Promise.all([
      DailySummary.countDocuments({ ...summaryMatch, status: { $in: ['in_progress'] } }),
      DailySummary.countDocuments({ ...summaryMatch, status: 'pending_approval' }),
      DailySummary.countDocuments({ ...summaryMatch, status: 'approved', 'posting.status': { $ne: 'POSTED' } }),
      DailySummary.countDocuments({ ...summaryMatch, 'posting.status': 'FAILED' }),
      DailySummary.countDocuments({ ...summaryMatch, status: 'rejected' }),
      SettlementConfirmation.countDocuments({ ...settlementMatch, settlementStatus: { $in: ['VARIANCE_DETECTED', 'ESCALATED'] } }),
      SettlementConfirmation.countDocuments({ ...settlementMatch, settlementStatus: 'NOT_REVIEWED' }),
      SaleTransaction.countDocuments({ ...saleMatch, $or: [{ status: 'voided' }, { 'voiding.isVoided': true }] }),
      SaleTransaction.countDocuments({ ...saleMatch, 'priceOverride.isOverride': true }),
      StatementUpload.aggregate([
        { $match: branchKey ? { branchId: String(branchKey) } : {} },
        {
          $group: {
            _id: null,
            duplicateReferences: { $sum: '$summary.duplicateReferenceCount' },
            unmatchedRows: { $sum: '$summary.unmatchedCount' },
            uploads: { $sum: 1 },
          },
        },
      ]),
    ]);

    let walletLiabilityEstimate = 0;
    if (WalletTransaction) {
      const walletRows = await WalletTransaction.aggregate([
        { $match: { createdAt: { $lte: end }, status: { $in: ['COMPLETED', 'Completed', 'completed'] } } },
        { $group: { _id: '$type', total: { $sum: '$amount' } } },
      ]);
      const creditTypes = ['DEPOSIT', 'ADJUSTMENT_CREDIT'];
      const debitTypes = ['WITHDRAWAL', 'REFUND', 'ADJUSTMENT_DEBIT', 'FEE'];
      const credits = (walletRows || []).filter((r) => creditTypes.includes(String(r._id || '').toUpperCase())).reduce((sum, r) => sum + _safeNum(r.total, 0), 0);
      const debits = (walletRows || []).filter((r) => debitTypes.includes(String(r._id || '').toUpperCase())).reduce((sum, r) => sum + _safeNum(r.total, 0), 0);
      walletLiabilityEstimate = credits - debits;
    }

    const statementSummary = statementAgg?.[0] || {};
    const indicators = [
      { key: 'unfinalizedDays', label: 'Unfinalized daily closes', count: unfinalizedDays, severity: unfinalizedDays > 0 ? 'HIGH' : 'OK' },
      { key: 'pendingApprovalDays', label: 'Sales entered but not approved', count: pendingApprovalDays, severity: pendingApprovalDays > 0 ? 'HIGH' : 'OK' },
      { key: 'approvedButUnpostedDays', label: 'Approved but not posted', count: approvedButUnpostedDays, severity: approvedButUnpostedDays > 0 ? 'HIGH' : 'OK' },
      { key: 'failedPostingDays', label: 'Failed postings', count: failedPostingDays, severity: failedPostingDays > 0 ? 'CRITICAL' : 'OK' },
      { key: 'settlementVariances', label: 'Posted/approved but not settled or variance detected', count: settlementVariances, severity: settlementVariances > 0 ? 'HIGH' : 'OK' },
      { key: 'unreviewedSettlements', label: 'Unreviewed settlement confirmations', count: unreviewedSettlements, severity: unreviewedSettlements > 0 ? 'MEDIUM' : 'OK' },
      { key: 'voidedSales', label: 'Voided sales', count: voidedSales, severity: voidedSales > 0 ? 'MEDIUM' : 'OK' },
      { key: 'priceOverrides', label: 'Price overrides', count: priceOverrides, severity: priceOverrides > 0 ? 'MEDIUM' : 'OK' },
      { key: 'duplicateStatementReferences', label: 'Duplicate statement references', count: _safeNum(statementSummary.duplicateReferences, 0), severity: _safeNum(statementSummary.duplicateReferences, 0) > 0 ? 'MEDIUM' : 'OK' },
      { key: 'unmatchedStatementRows', label: 'Unmatched uploaded statement rows', count: _safeNum(statementSummary.unmatchedRows, 0), severity: _safeNum(statementSummary.unmatchedRows, 0) > 0 ? 'MEDIUM' : 'OK' },
    ];

    const totalExceptions = indicators.reduce((sum, x) => sum + _safeNum(x.count, 0), 0);

    return res.json({
      ok: true,
      optional: true,
      blocking: false,
      period: { start, end },
      branchId: branchKey,
      totalExceptions,
      walletLiabilityEstimate,
      walletLiabilityNote: 'Estimate only; no automatic wallet liability GL posting is performed in Wave 11A.',
      indicators,
    });
  } catch (e) {
    return next(e);
  }
};

const exportSettlements = async (req, res, next) => {
  try {
    const { start, end } = getDateRange(req.query.period || 'custom', req.query.startDate, req.query.endDate);
    const branchKey = req.query.branchId || req.query.serviceZoneId || null;
    const q = { businessDate: { $gte: start, $lte: end } };
    if (branchKey) q.branchId = String(branchKey);

    const rows = await SettlementConfirmation.find(q).sort({ businessDate: -1 }).lean();
    const data = rows.map((r) => ({
      BusinessDate: r.businessDate ? new Date(r.businessDate).toISOString().slice(0, 10) : '',
      BranchId: r.branchId || '',
      Cashier: r.cashierName || '',
      Status: r.settlementStatus || '',
      ExpectedCash: _safeNum(r.expected?.expectedCashOnHand, 0),
      ActualCash: r.cash?.actualAmount ?? '',
      CashVariance: _safeNum(r.cash?.variance, 0),
      ExpectedTransfer: _safeNum(r.expected?.transferSales, 0),
      ActualTransfer: r.transfer?.actualAmount ?? '',
      TransferVariance: _safeNum(r.transfer?.variance, 0),
      ExpectedPOS: _safeNum(r.expected?.posSales, 0),
      ActualPOS: r.pos?.actualAmount ?? '',
      POSVariance: _safeNum(r.pos?.variance, 0),
      LastReviewedBy: r.lastReviewedBy || '',
      LastReviewedAt: r.lastReviewedAt ? new Date(r.lastReviewedAt).toISOString() : '',
    }));

    if (req.query.format === 'json') return res.json({ ok: true, count: data.length, items: data });

    const headers = data.length ? Object.keys(data[0]) : ['Message'];
    const csv = [
      headers.map(_safeCsv).join(','),
      ...(data.length ? data.map((row) => headers.map((h) => _safeCsv(row[h])).join(',')) : ['No data for selected period']),
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="settlement_confirmations_${Date.now()}.csv"`);
    return res.send(csv);
  } catch (e) {
    return next(e);
  }
};

const exportFinancialReport = async (req, res, next) => {
  try {
    const type = String(req.query.type || 'cash-movement');
    const branchKey = req.query.branchId || req.query.serviceZoneId || null;
    const { start, end } = getDateRange(req.query.period || 'custom', req.query.startDate, req.query.endDate);
    let rows = [];

    if (type === 'management-accounts' || type === 'financials' || type === 'statements') {
      const statementPayload = await new Promise((resolve, reject) => {
        const fakeReq = {
          ...req,
          query: {
            ...req.query,
            period: req.query.period || 'custom',
            startDate: req.query.startDate,
            endDate: req.query.endDate,
            branchId: req.query.branchId,
            serviceZoneId: req.query.serviceZoneId,
            sourceMode: req.query.sourceMode || req.query.source || 'auto',
          },
        };
        const fakeRes = {
          status: () => fakeRes,
          json: (payload) => resolve(payload),
        };
        getFinancialStatements(fakeReq, fakeRes, (err) => reject(err || new Error('Failed to generate management accounts')));
      });
      const push = (Section, Item, Amount, Notes = '') => rows.push({ Section, Item, Amount: _safeNum(Amount, 0), Notes });
      const income = statementPayload?.income || {};
      const revenue = income?.revenue || {};
      const expenses = income?.expenses || {};
      push('P&L', 'Revenue - Total', revenue.total, `Source: ${statementPayload?.gl?.sourceMode || 'unknown'}`);
      push('P&L', 'Revenue - POS', revenue.pos);
      push('P&L', 'Revenue - Delivery Recognized', revenue.delivery);
      push('P&L', 'COGS', income?.cogs?.total);
      push('P&L', 'Gross Profit', income?.grossProfit);
      push('P&L', 'OPEX - Staff Costs', expenses.salaries);
      push('P&L', 'OPEX - Logistics & Fuel', expenses.logistics);
      push('P&L', 'OPEX - Utilities', expenses.utilities);
      push('P&L', 'OPEX - Maintenance', expenses.maintenance);
      push('P&L', 'OPEX - Marketing', expenses.marketing);
      push('P&L', 'OPEX - Admin & General', expenses.admin);
      push('P&L', 'OPEX - Total', expenses.total, `Expense source: ${expenses.source || 'N/A'}`);
      push('P&L', 'EBITDA', income?.ebitda);
      push('P&L', 'Depreciation', income?.depreciation);
      push('P&L', 'Interest', income?.interest);
      push('P&L', 'Tax', income?.tax);
      push('P&L', 'Net Income', income?.netIncome);
      for (const a of statementPayload?.balance?.assets || []) push('Balance Sheet - Assets', a.name, a.value);
      for (const l of statementPayload?.balance?.liabilities || []) push('Balance Sheet - Liabilities', l.name, l.value);
      for (const e of statementPayload?.balance?.equity || []) push('Balance Sheet - Equity', e.name, e.value);
      push('Cash Flow', 'Operating', statementPayload?.cashFlow?.operating);
      push('Cash Flow', 'Investing', statementPayload?.cashFlow?.investing);
      push('Cash Flow', 'Financing', statementPayload?.cashFlow?.financing);
      push('Ratios', 'Gross Margin %', statementPayload?.ratios?.grossMargin);
      push('Ratios', 'Net Margin %', statementPayload?.ratios?.netMargin);
      push('Ratios', 'DSCR', statementPayload?.ratios?.dscr);
    } else if (type === 'expense-analysis') {
      const q = { date: { $gte: start, $lte: end }, 'voiding.isVoided': { $ne: true } };
      if (branchKey) Object.assign(q, buildBranchOrZoneMatch(branchKey));
      const expenses = await ExpenseTransaction.find(q).sort({ date: -1 }).lean();
      rows = expenses.map((x) => ({
        Date: x.date ? new Date(x.date).toISOString().slice(0, 10) : '',
        BranchId: x.branchId || '',
        Cashier: x.cashierName || '',
        Category: x.category || '',
        Description: x.description || '',
        PaymentDisposition: x.paymentDisposition || '',
        Amount: _safeNum(x.amount, 0),
        Status: x.status || '',
        PostingStatus: x.posting?.status || 'UNPOSTED',
      }));
    } else if (type === 'branch-pl') {
      if (!GeneralLedgerEntry) throw new HttpError(501, 'GL model is not available');
      const q = { status: 'POSTED', date: { $gte: start, $lte: end } };
      if (branchKey) q.branchKey = String(branchKey);
      const journals = await GeneralLedgerEntry.find(q).select('_id date branchKey sourceType sourceId narration status lines').lean();
      const rowsByBranch = new Map();
      for (const row of _journalLineRows(journals)) {
        const key = String(row.branchKey || 'UNASSIGNED');
        const arr = rowsByBranch.get(key) || [];
        arr.push(row);
        rowsByBranch.set(key, arr);
      }
      rows = [...rowsByBranch.entries()].map(([key, lineRows]) => {
        const pl = _summarizeGLForPL(lineRows);
        return {
          BranchId: key,
          Revenue: pl.revenue,
          COGS: pl.cogs,
          GrossProfit: pl.grossProfit,
          OPEX: pl.opex,
          NetProfit: pl.netProfit,
          GrossMarginPct: pl.revenue > 0 ? ((pl.grossProfit / pl.revenue) * 100).toFixed(2) : '0.00',
          NetMarginPct: pl.revenue > 0 ? ((pl.netProfit / pl.revenue) * 100).toFixed(2) : '0.00',
          JournalLineCount: lineRows.length,
        };
      });
    } else if (type === 'failed-payments') {
      const q = {
        ...buildBranchOrZoneMatch(branchKey),
        $or: [
          { paymentStatus: { $in: ['Failed', 'FAILED', 'failed'] } },
          { status: { $in: ['Failed', 'Vending Failed'] } },
          { paymentVerificationDelayed: true },
        ],
        createdAt: { $gte: start, $lte: end },
      };
      const items = await Order.find(q).sort({ createdAt: -1 }).lean();
      rows = items.map((x) => ({
        Date: x.orderDate || x.createdAt ? new Date(x.orderDate || x.createdAt).toISOString().slice(0, 10) : '',
        OrderId: x.id || x._id,
        Customer: x.recipientName || '',
        Phone: x.recipientPhone || '',
        BranchId: x.branchId || x.serviceZoneId || '',
        Status: x.status || '',
        PaymentStatus: x.paymentStatus || '',
        Method: x.paymentMethod || '',
        Gateway: x.paymentGateway || '',
        Reference: x.paymentGatewayReference || x.paymentTransactionId || '',
        Amount: _safeNum(x.grandTotal, 0),
      }));
    } else if (type === 'wallet-liability') {
      const walletRows = await _getWalletRows({ start, end, limit: 10000 });
      rows = walletRows.map((r) => ({
        Date: r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : '',
        TransactionId: r.id || r._id,
        UserId: r.userId || '',
        Type: r.type || '',
        Direction: _walletTypeDirection(r.type),
        Amount: _safeNum(r.amount, 0),
        Status: r.status || '',
        OrderId: r.orderId || '',
        GatewayTransactionId: r.gatewayTransactionId || '',
        Description: r.description || '',
      }));
    } else {
      if (!GeneralLedgerEntry) throw new HttpError(501, 'GL model is not available');
      const q = { status: 'POSTED', date: { $gte: start, $lte: end } };
      if (branchKey) q.branchKey = String(branchKey);
      const journals = await GeneralLedgerEntry.find(q).sort({ date: -1 }).lean();
      const allowedAccounts = type === 'cash-movement' ? Object.keys(CASH_ACCOUNT_LABELS) : null;
      journals.forEach((j) => (j.lines || []).forEach((l) => {
        if (allowedAccounts && !allowedAccounts.includes(String(l.accountCode))) return;
        rows.push({
          Date: j.date ? new Date(j.date).toISOString().slice(0, 10) : '',
          JournalId: j._id,
          BranchKey: j.branchKey || '',
          SourceType: j.sourceType,
          SourceId: j.sourceId,
          AccountCode: l.accountCode,
          Debit: l.debit || 0,
          Credit: l.credit || 0,
          NetMovement: _safeNum(l.debit, 0) - _safeNum(l.credit, 0),
          Narration: l.narration || j.narration || '',
          Status: j.status || '',
        });
      }));
    }

    const fields = rows.length ? Object.keys(rows[0]) : ['Message'];
    const parser = new Parser({ fields });
    const csv = parser.parse(rows.length ? rows : [{ Message: 'No data for selected period' }]);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${type}_${Date.now()}.csv"`);
    return res.send(csv);
  } catch (e) { return next(e); }
};

module.exports = {
  getFinancialStatements,
  getMigrationReconciliationReport,
  exportData,
  getRevenueAssuranceReport,
  getTaxComplianceReport,
  getCashMovementReport,
  getExpenseAnalysisReport,
  getBranchProfitLossReport,
  getSourceTraceReport,
  getWalletLiabilityReport,
  getFailedPaymentReviewQueue,
  getSettlementDashboard,
  getSettlementConfirmations,
  confirmSettlement,
  createStatementUpload,
  listStatementUploads,
  getRevenueLeakageDashboard,
  exportSettlements,
  exportFinancialReport,
};
