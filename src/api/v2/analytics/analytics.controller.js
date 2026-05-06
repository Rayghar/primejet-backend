// src/api/v2/analytics/analytics.controller.js
const mongoose = require('mongoose');

const Order = require('../../../models/order.model');
const Run = require('../../../models/run.model');
const User = require('../../../models/user.model');
const Plant = require('../../../models/plant.model');
const DailySummary = require('../../../models/dailySummary.model');
const ExpenseTransaction = require('../../../models/expenseTransaction.model');
const StockIn = require('../../../models/stockIn.model');
const StockMovement = require('../../../models/stockMovement.model');
const SupportTicket = require('../../../models/supportTicket.model');
const GeneralLedgerEntry = require('../../../models/generalLedgerEntry.model');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');

/**
 * Wave 14A Analytics Controller
 *
 * Goal:
 * - De-staticize dashboard/analytics screens.
 * - Use actual operational, POS, delivery, GL, customer, driver and support data.
 * - Keep the implementation additive and tolerant of partially migrated data.
 *
 * Ledger/revenue rules:
 * - DELIVERY revenue = Orders where status=Delivered and paymentStatus is paid/completed/success.
 * - POS revenue = DailySummary where status is approved/posted/closed, using DailySummary.date.
 * - Orders use orderDate first, then createdAt where orderDate is missing.
 */

// -----------------------------------------------------------------------------
// Tiny helpers
// -----------------------------------------------------------------------------
const _safeNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const _asObjectId = (v) =>
  mongoose.Types.ObjectId.isValid(String(v)) ? new mongoose.Types.ObjectId(String(v)) : null;

const _pctChange = (current, previous) => {
  const c = _safeNum(current, 0);
  const p = _safeNum(previous, 0);
  if (p === 0) return c > 0 ? 100 : 0;
  return ((c - p) / Math.abs(p)) * 100;
};

const _round = (n, dp = 2) => {
  const p = 10 ** dp;
  return Math.round(_safeNum(n, 0) * p) / p;
};

const _startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

const _endOfDay = (d) => {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
};

const _daysBetween = (a, b) => {
  const start = new Date(a).getTime();
  const end = new Date(b).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24)));
};

/**
 * branchId == serviceZoneId tolerant matcher.
 * Supports mixed schemas across collections:
 * - branchId stored as ObjectId or string
 * - OR serviceZoneId/zoneId/plantId stored as string
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
    ors.push({ branchId: oid }, { serviceZoneId: oid }, { zoneId: oid }, { plantId: oid });
  }

  return { $or: ors };
};

/**
 * Period helper.
 * Supports old dashboard values and new analytics values:
 * weekly|monthly|quarterly|yearly|allTime|custom.
 */
const getDateRange = (period = 'monthly', customStart, customEnd) => {
  const now = new Date();
  let start = new Date(now.getFullYear(), now.getMonth(), 1);
  let end = new Date();

  if (period === 'weekly') {
    const day = now.getDay();
    const diff = day === 0 ? 6 : day - 1; // Monday as first day
    start = _startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff));
  } else if (period === 'monthly') {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (period === 'quarterly') {
    const quarter = Math.floor(now.getMonth() / 3);
    start = new Date(now.getFullYear(), quarter * 3, 1);
  } else if (period === 'yearly') {
    start = new Date(now.getFullYear(), 0, 1);
  } else if (period === 'allTime' || period === 'allMigrated') {
    // PrimeJet migration baseline: uploaded historical operating data starts from June 2025.
    // This keeps "All Migrated Data" aligned with management reporting instead of showing a misleading 2020 baseline.
    start = new Date('2025-06-01T00:00:00.000Z');
  } else if (period === 'custom' && customStart && customEnd) {
    start = new Date(customStart);
    end = new Date(customEnd);
  }

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    start = new Date(now.getFullYear(), 0, 1);
    end = new Date();
  }

  start = _startOfDay(start);
  end = _endOfDay(end);

  return { start, end };
};

const getPreviousRange = (start, end) => {
  const days = _daysBetween(start, end);
  const prevEnd = new Date(start);
  prevEnd.setDate(prevEnd.getDate() - 1);
  prevEnd.setHours(23, 59, 59, 999);

  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - days + 1);
  prevStart.setHours(0, 0, 0, 0);

  return { start: prevStart, end: prevEnd };
};

const _isPaidExpr = () => ({
  $in: [
    { $toLower: { $ifNull: ['$paymentStatus', ''] } },
    ['completed', 'paid', 'success', 'successful'],
  ],
});

const _normalizeOrderPaymentMethodExpr = () => ({
  $switch: {
    branches: [
      { case: { $eq: ['$paymentMethod', 'card'] }, then: 'POS' },
      { case: { $eq: ['$paymentMethod', 'paystack'] }, then: 'PAYSTACK' },
      { case: { $eq: ['$paymentMethod', 'stripe'] }, then: 'STRIPE' },
      { case: { $eq: ['$paymentMethod', 'wallet'] }, then: 'WALLET' },
      { case: { $eq: ['$paymentMethod', 'payOnPickup'] }, then: 'PAY_ON_PICKUP' },
    ],
    default: { $ifNull: ['$paymentMethod', 'Unknown'] },
  },
});

const _ordersMatch = (start, end, branchMatch = {}) => ({
  ...branchMatch,
  $and: [{ $or: [{ channel: { $exists: false } }, { channel: 'DELIVERY' }] }],
  $or: [
    { orderDate: { $gte: start, $lte: end } },
    { orderDate: { $exists: false }, createdAt: { $gte: start, $lte: end } },
  ],
  $expr: {
    $and: [
      { $eq: [{ $toLower: { $ifNull: ['$status', ''] } }, 'delivered'] },
      _isPaidExpr(),
    ],
  },
});

const _ordersDeliveredUnpaidMatch = (start, end, branchMatch = {}) => ({
  ...branchMatch,
  $and: [{ $or: [{ channel: { $exists: false } }, { channel: 'DELIVERY' }] }],
  $or: [
    { orderDate: { $gte: start, $lte: end } },
    { orderDate: { $exists: false }, createdAt: { $gte: start, $lte: end } },
  ],
  $expr: {
    $and: [
      { $eq: [{ $toLower: { $ifNull: ['$status', ''] } }, 'delivered'] },
      { $not: [_isPaidExpr()] },
    ],
  },
});

const _dailySummaryMatch = (start, end, branchMatch = {}) => ({
  ...branchMatch,
  status: { $in: ['approved', 'posted', 'closed'] },
  date: { $gte: start, $lte: end },
});

const _ordersBaseProject = () => ({
  $project: {
    _id: 0,
    id: { $toString: '$_id' },
    orderId: '$id',
    businessDate: { $ifNull: ['$orderDate', '$createdAt'] },
    customerId: '$customerId',
    driverId: '$driverId',
    grandTotal: { $ifNull: ['$grandTotal', '$totalAmount'] },
    items: { $ifNull: ['$items', []] },
    paymentMethod: _normalizeOrderPaymentMethodExpr(),
    branchId: { $ifNull: ['$branchId', { $ifNull: ['$serviceZoneId', { $ifNull: ['$zoneId', '$plantId'] }] }] },
    lat: { $ifNull: ['$deliveryLatitude', '$deliveryAddressSnapshot.latitude'] },
    lng: { $ifNull: ['$deliveryLongitude', '$deliveryAddressSnapshot.longitude'] },
    source: { $literal: 'order_delivery' },
  },
});

const _ordersAddFields = () => ({
  $addFields: {
    grandTotal: { $ifNull: ['$grandTotal', 0] },
    totalKgSold: {
      $cond: [{ $isArray: '$items' }, { $sum: '$items.quantity' }, 0],
    },
  },
});

const _dailySummaryProjectAsSale = () => ({
  $project: {
    _id: 0,
    id: '$dailySummaryId',
    businessDate: '$date',
    customerId: null,
    grandTotal: { $ifNull: ['$sales.totalRevenue', 0] },
    items: [
      {
        productName: 'LPG Gas',
        quantity: { $ifNull: ['$sales.totalKgSold', 0] },
        unitPrice: { $ifNull: ['$pricePerKg', 0] },
      },
    ],
    paymentMethod: { $literal: 'DAILY_LOG' },
    branchId: '$branchId',
    totalCash: { $ifNull: ['$sales.cashAmount', 0] },
    totalPOS: { $ifNull: ['$sales.posAmount', 0] },
    totalTransfer: { $ifNull: ['$sales.transferAmount', 0] },
    totalExpenses: { $ifNull: ['$expenses.total', 0] },
    source: { $literal: 'daily_log' },
  },
});

const _dailySummaryAddFields = () => ({
  $addFields: {
    grandTotal: { $ifNull: ['$grandTotal', 0] },
    totalKgSold: {
      $cond: [{ $isArray: '$items' }, { $sum: '$items.quantity' }, 0],
    },
    paymentMethod: { $literal: 'DAILY_LOG' },
  },
});

const _aggregateOrders = async ({ start, end, branchMatch }, extraPipeline = []) => {
  const pipeline = [
    { $match: _ordersMatch(start, end, branchMatch) },
    _ordersBaseProject(),
    _ordersAddFields(),
    ...extraPipeline,
  ];
  return Order.aggregate(pipeline);
};

const _aggregateOrdersDeliveredUnpaid = async ({ start, end, branchMatch }, extraPipeline = []) => {
  const pipeline = [
    { $match: _ordersDeliveredUnpaidMatch(start, end, branchMatch) },
    _ordersBaseProject(),
    _ordersAddFields(),
    ...extraPipeline,
  ];
  return Order.aggregate(pipeline);
};

const _aggregateDailySummaries = async ({ start, end, branchMatch }, extraPipeline = []) => {
  const pipeline = [
    { $match: _dailySummaryMatch(start, end, branchMatch) },
    _dailySummaryProjectAsSale(),
    _dailySummaryAddFields(),
    ...extraPipeline,
  ];
  return DailySummary.aggregate(pipeline);
};

const _yearMonthKey = (y, m) => `${y}-${String(m).padStart(2, '0')}`;

const _mergeByKey = (rowsA, rowsB, keyFn) => {
  const map = new Map();

  const add = (r) => {
    const k = keyFn(r);
    const prev = map.get(k) || { ...r, totalRevenue: 0, totalKgSold: 0, count: 0 };
    map.set(k, {
      ...prev,
      ...r,
      totalRevenue: _safeNum(prev.totalRevenue) + _safeNum(r.totalRevenue),
      totalKgSold: _safeNum(prev.totalKgSold) + _safeNum(r.totalKgSold),
      count: _safeNum(prev.count) + _safeNum(r.count),
      totalAmount: _safeNum(prev.totalAmount) + _safeNum(r.totalAmount || r.totalRevenue),
    });
  };

  (rowsA || []).forEach(add);
  (rowsB || []).forEach(add);

  return Array.from(map.values());
};

const _loadPlantMap = async () => {
  let plants = [];
  try {
    plants = await Plant.find({}).lean();
  } catch (e) {
    plants = [];
  }

  const map = new Map();
  for (const p of plants || []) {
    if (!p) continue;
    if (p.id != null) map.set(String(p.id), p.name || 'Unnamed Branch');
    if (p._id != null) map.set(String(p._id), p.name || 'Unnamed Branch');
  }
  return map;
};



// -----------------------------------------------------------------------------
// Wave 22C-Fix: Gas plant financial dashboard
// -----------------------------------------------------------------------------
const _monthKeyFromDateParts = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
const _quarterKeyFromMonthKey = (monthKey) => {
  const [year, month] = String(monthKey || '').split('-').map(Number);
  if (!year || !month) return 'Unknown';
  return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
};

const _datePartsToMonthKey = (id = {}) => _monthKeyFromDateParts(id.year, id.month);

const _sumRows = (rows = [], fields = []) => rows.reduce((acc, row) => {
  fields.forEach((field) => { acc[field] = _safeNum(acc[field]) + _safeNum(row?.[field]); });
  return acc;
}, fields.reduce((a, f) => ({ ...a, [f]: 0 }), {}));

const _getOperationalSummary = async ({ start, end, branchMatch }) => {
  const [salesRows, expenseRows, stockPurchaseRows, movementRows, unpostedRows, glRows] = await Promise.all([
    DailySummary.aggregate([
      { $match: _dailySummaryMatch(start, end, branchMatch) },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: { $ifNull: ['$sales.totalRevenue', 0] } },
          totalKgSold: { $sum: { $ifNull: ['$sales.totalKgSold', 0] } },
          cashAmount: { $sum: { $ifNull: ['$sales.cashAmount', 0] } },
          posAmount: { $sum: { $ifNull: ['$sales.posAmount', 0] } },
          transferAmount: { $sum: { $ifNull: ['$sales.transferAmount', 0] } },
          closeExpensesStored: { $sum: { $ifNull: ['$expenses.total', 0] } },
          varianceAmount: { $sum: { $ifNull: ['$reconciliation.discrepancy', 0] } },
          dailyCloseCount: { $sum: 1 },
        },
      },
    ]),
    ExpenseTransaction.aggregate([
      { $match: { ...branchMatch, date: { $gte: start, $lte: end }, status: { $in: ['approved', 'Approved', 'APPROVED', 'posted', 'POSTED'] } } },
      { $group: { _id: null, totalExpenses: { $sum: '$amount' }, expenseCount: { $sum: 1 } } },
    ]).catch(() => []),
    StockIn.aggregate([
      { $match: { ...branchMatch, purchaseDate: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: null,
          stockInKg: { $sum: '$quantityKg' },
          stockPurchaseCost: { $sum: { $multiply: [{ $ifNull: ['$quantityKg', 0] }, { $ifNull: ['$costPerKg', 0] }] } },
          stockInCount: { $sum: 1 },
        },
      },
    ]).catch(() => []),
    StockMovement.aggregate([
      { $match: { ...branchMatch, movementDate: { $gte: start, $lte: end }, direction: 'OUT' } },
      {
        $group: {
          _id: '$movementType',
          quantityKg: { $sum: '$quantityKg' },
          totalCost: { $sum: '$totalCost' },
          count: { $sum: 1 },
        },
      },
    ]).catch(() => []),
    Promise.all([
      DailySummary.countDocuments({ ...branchMatch, date: { $gte: start, $lte: end }, status: { $in: ['approved', 'posted', 'closed'] }, 'posting.status': { $in: ['UNPOSTED', 'QUEUED', 'FAILED'] } }).catch(() => 0),
      ExpenseTransaction.countDocuments({ ...branchMatch, date: { $gte: start, $lte: end }, status: { $in: ['approved', 'Approved', 'APPROVED'] }, 'posting.status': { $in: ['UNPOSTED', 'QUEUED', 'FAILED'] } }).catch(() => 0),
      StockIn.countDocuments({ ...branchMatch, purchaseDate: { $gte: start, $lte: end }, 'posting.status': { $in: ['UNPOSTED', 'QUEUED', 'FAILED'] } }).catch(() => 0),
      DailySummary.countDocuments({ ...branchMatch, date: { $gte: start, $lte: end }, 'posting.status': 'FAILED' }).catch(() => 0),
      ExpenseTransaction.countDocuments({ ...branchMatch, date: { $gte: start, $lte: end }, 'posting.status': 'FAILED' }).catch(() => 0),
      StockIn.countDocuments({ ...branchMatch, purchaseDate: { $gte: start, $lte: end }, 'posting.status': 'FAILED' }).catch(() => 0),
    ]),
    GeneralLedgerEntry.aggregate([
      { $match: { date: { $gte: start, $lte: end }, status: 'POSTED' } },
      { $group: { _id: null, journalCount: { $sum: 1 }, totalDebits: { $sum: '$totals.debit' }, totalCredits: { $sum: '$totals.credit' } } },
    ]).catch(() => []),
  ]);

  const sales = salesRows?.[0] || {};
  const expense = expenseRows?.[0] || {};
  const stock = stockPurchaseRows?.[0] || {};
  const movementMap = new Map((movementRows || []).map((r) => [String(r._id), r]));
  const saleCogs = ['SALE_DEPLETION', 'ORDER_DEPLETION'].reduce((sum, key) => sum + _safeNum(movementMap.get(key)?.totalCost), 0);
  const saleCogsKg = ['SALE_DEPLETION', 'ORDER_DEPLETION'].reduce((sum, key) => sum + _safeNum(movementMap.get(key)?.quantityKg), 0);
  const stockLoss = movementMap.get('RECONCILIATION_VARIANCE') || {};
  const totalRevenue = _safeNum(sales.totalRevenue);
  const totalKgSold = _safeNum(sales.totalKgSold);
  const totalExpenses = _safeNum(expense.totalExpenses);
  const cogs = _safeNum(saleCogs);
  const stockLossValue = _safeNum(stockLoss.totalCost);
  const grossProfit = totalRevenue - cogs;
  const netContribution = grossProfit - totalExpenses - stockLossValue;
  const avgSellingPricePerKg = totalKgSold > 0 ? totalRevenue / totalKgSold : 0;
  const avgCogsPerKg = saleCogsKg > 0 ? cogs / saleCogsKg : 0;

  return {
    totalRevenue: _round(totalRevenue, 2),
    totalKgSold: _round(totalKgSold, 3),
    avgSellingPricePerKg: _round(avgSellingPricePerKg, 2),
    cashAmount: _round(sales.cashAmount, 2),
    posAmount: _round(sales.posAmount, 2),
    transferAmount: _round(sales.transferAmount, 2),
    totalExpenses: _round(totalExpenses, 2),
    cogs: _round(cogs, 2),
    avgCogsPerKg: _round(avgCogsPerKg, 2),
    grossProfit: _round(grossProfit, 2),
    grossMarginPct: totalRevenue > 0 ? _round((grossProfit / totalRevenue) * 100, 2) : 0,
    netContribution: _round(netContribution, 2),
    netContributionMarginPct: totalRevenue > 0 ? _round((netContribution / totalRevenue) * 100, 2) : 0,
    stockInKg: _round(stock.stockInKg, 3),
    stockPurchaseCost: _round(stock.stockPurchaseCost, 2),
    stockLossKg: _round(stockLoss.quantityKg, 3),
    stockLossValue: _round(stockLossValue, 2),
    dailyCloseCount: _safeNum(sales.dailyCloseCount),
    expenseCount: _safeNum(expense.expenseCount),
    stockInCount: _safeNum(stock.stockInCount),
    varianceAmount: _round(sales.varianceAmount, 2),
    unposted: {
      dailySummaries: _safeNum(unpostedRows?.[0]),
      expenses: _safeNum(unpostedRows?.[1]),
      stockIns: _safeNum(unpostedRows?.[2]),
      total: _safeNum(unpostedRows?.[0]) + _safeNum(unpostedRows?.[1]) + _safeNum(unpostedRows?.[2]),
    },
    failedPostings: {
      dailySummaries: _safeNum(unpostedRows?.[3]),
      expenses: _safeNum(unpostedRows?.[4]),
      stockIns: _safeNum(unpostedRows?.[5]),
      total: _safeNum(unpostedRows?.[3]) + _safeNum(unpostedRows?.[4]) + _safeNum(unpostedRows?.[5]),
    },
    postedGL: {
      journalCount: _safeNum(glRows?.[0]?.journalCount),
      totalDebits: _round(glRows?.[0]?.totalDebits, 2),
      totalCredits: _round(glRows?.[0]?.totalCredits, 2),
      balanced: Math.abs(_safeNum(glRows?.[0]?.totalDebits) - _safeNum(glRows?.[0]?.totalCredits)) < 0.01,
    },
  };
};

const _mergePeriodRow = (map, label, patch = {}) => {
  if (!label || label === 'NaN-NaN') return;
  const prev = map.get(label) || {
    label,
    totalRevenue: 0,
    totalKgSold: 0,
    cashAmount: 0,
    posAmount: 0,
    transferAmount: 0,
    totalExpenses: 0,
    cogs: 0,
    stockLossValue: 0,
    stockLossKg: 0,
    stockInKg: 0,
    stockPurchaseCost: 0,
    dailyCloseCount: 0,
  };
  for (const [key, value] of Object.entries(patch)) prev[key] = _safeNum(prev[key]) + _safeNum(value);
  map.set(label, prev);
};

const _finalizeTrendRows = (rows) => rows.map((r) => {
  const grossProfit = _safeNum(r.totalRevenue) - _safeNum(r.cogs);
  const netContribution = grossProfit - _safeNum(r.totalExpenses) - _safeNum(r.stockLossValue);
  return {
    ...r,
    totalRevenue: _round(r.totalRevenue, 2),
    totalKgSold: _round(r.totalKgSold, 3),
    totalExpenses: _round(r.totalExpenses, 2),
    cogs: _round(r.cogs, 2),
    stockLossValue: _round(r.stockLossValue, 2),
    grossProfit: _round(grossProfit, 2),
    grossMarginPct: _safeNum(r.totalRevenue) > 0 ? _round((grossProfit / _safeNum(r.totalRevenue)) * 100, 2) : 0,
    netContribution: _round(netContribution, 2),
    avgPricePerKg: _safeNum(r.totalKgSold) > 0 ? _round(_safeNum(r.totalRevenue) / _safeNum(r.totalKgSold), 2) : 0,
  };
});

const _getMonthlyTrend = async ({ start, end, branchMatch }) => {
  const monthMap = new Map();
  const [sales, expenses, movements, stockIns] = await Promise.all([
    DailySummary.aggregate([
      { $match: _dailySummaryMatch(start, end, branchMatch) },
      {
        $group: {
          _id: { year: { $year: '$date' }, month: { $month: '$date' } },
          totalRevenue: { $sum: { $ifNull: ['$sales.totalRevenue', 0] } },
          totalKgSold: { $sum: { $ifNull: ['$sales.totalKgSold', 0] } },
          cashAmount: { $sum: { $ifNull: ['$sales.cashAmount', 0] } },
          posAmount: { $sum: { $ifNull: ['$sales.posAmount', 0] } },
          transferAmount: { $sum: { $ifNull: ['$sales.transferAmount', 0] } },
          dailyCloseCount: { $sum: 1 },
        },
      },
    ]),
    ExpenseTransaction.aggregate([
      { $match: { ...branchMatch, date: { $gte: start, $lte: end }, status: { $in: ['approved', 'Approved', 'APPROVED', 'posted', 'POSTED'] } } },
      { $group: { _id: { year: { $year: '$date' }, month: { $month: '$date' } }, totalExpenses: { $sum: '$amount' } } },
    ]).catch(() => []),
    StockMovement.aggregate([
      { $match: { ...branchMatch, movementDate: { $gte: start, $lte: end }, direction: 'OUT' } },
      {
        $group: {
          _id: { year: { $year: '$movementDate' }, month: { $month: '$movementDate' }, movementType: '$movementType' },
          quantityKg: { $sum: '$quantityKg' },
          totalCost: { $sum: '$totalCost' },
        },
      },
    ]).catch(() => []),
    StockIn.aggregate([
      { $match: { ...branchMatch, purchaseDate: { $gte: start, $lte: end } } },
      { $group: { _id: { year: { $year: '$purchaseDate' }, month: { $month: '$purchaseDate' } }, stockInKg: { $sum: '$quantityKg' }, stockPurchaseCost: { $sum: { $multiply: [{ $ifNull: ['$quantityKg', 0] }, { $ifNull: ['$costPerKg', 0] }] } } } },
    ]).catch(() => []),
  ]);

  (sales || []).forEach((r) => _mergePeriodRow(monthMap, _datePartsToMonthKey(r._id), r));
  (expenses || []).forEach((r) => _mergePeriodRow(monthMap, _datePartsToMonthKey(r._id), { totalExpenses: r.totalExpenses }));
  (stockIns || []).forEach((r) => _mergePeriodRow(monthMap, _datePartsToMonthKey(r._id), { stockInKg: r.stockInKg, stockPurchaseCost: r.stockPurchaseCost }));
  (movements || []).forEach((r) => {
    const label = _datePartsToMonthKey(r._id);
    if (['SALE_DEPLETION', 'ORDER_DEPLETION'].includes(String(r._id?.movementType))) {
      _mergePeriodRow(monthMap, label, { cogs: r.totalCost });
    } else if (String(r._id?.movementType) === 'RECONCILIATION_VARIANCE') {
      _mergePeriodRow(monthMap, label, { stockLossValue: r.totalCost, stockLossKg: r.quantityKg });
    }
  });

  return _finalizeTrendRows(Array.from(monthMap.values()).sort((a, b) => String(a.label).localeCompare(String(b.label))));
};

const _toQuarterlyTrend = (monthlyRows = []) => {
  const map = new Map();
  for (const row of monthlyRows || []) {
    const q = _quarterKeyFromMonthKey(row.label);
    _mergePeriodRow(map, q, row);
  }
  return _finalizeTrendRows(Array.from(map.values()).sort((a, b) => String(a.label).localeCompare(String(b.label))));
};

const _getBranchPerformanceSummary = async ({ start, end, branchMatch }) => {
  const [salesRows, expenseRows, movementRows, currentStockRows, plantMap] = await Promise.all([
    DailySummary.aggregate([
      { $match: _dailySummaryMatch(start, end, branchMatch) },
      { $group: { _id: '$branchId', totalRevenue: { $sum: '$sales.totalRevenue' }, totalKgSold: { $sum: '$sales.totalKgSold' }, cashAmount: { $sum: '$sales.cashAmount' }, posAmount: { $sum: '$sales.posAmount' }, transferAmount: { $sum: '$sales.transferAmount' }, dailyCloseCount: { $sum: 1 } } },
    ]),
    ExpenseTransaction.aggregate([
      { $match: { ...branchMatch, date: { $gte: start, $lte: end }, status: { $in: ['approved', 'Approved', 'APPROVED', 'posted', 'POSTED'] } } },
      { $group: { _id: '$branchId', totalExpenses: { $sum: '$amount' } } },
    ]).catch(() => []),
    StockMovement.aggregate([
      { $match: { ...branchMatch, movementDate: { $gte: start, $lte: end }, direction: 'OUT' } },
      { $group: { _id: { branchId: '$branchId', movementType: '$movementType' }, quantityKg: { $sum: '$quantityKg' }, totalCost: { $sum: '$totalCost' } } },
    ]).catch(() => []),
    StockIn.aggregate([
      { $match: { ...branchMatch } },
      { $group: { _id: '$branchId', currentStockKg: { $sum: '$remainingKg' }, inventoryValue: { $sum: { $multiply: [{ $ifNull: ['$remainingKg', 0] }, { $ifNull: ['$costPerKg', 0] }] } } } },
    ]).catch(() => []),
    _loadPlantMap(),
  ]);

  const map = new Map();
  const ensure = (id) => {
    const key = String(id || 'Unknown');
    if (!map.has(key)) map.set(key, { branchId: key, branchName: plantMap.get(key) || null, totalRevenue: 0, totalKgSold: 0, cashAmount: 0, posAmount: 0, transferAmount: 0, totalExpenses: 0, cogs: 0, stockLossKg: 0, stockLossValue: 0, currentStockKg: 0, inventoryValue: 0, dailyCloseCount: 0 });
    return map.get(key);
  };
  (salesRows || []).forEach((r) => Object.assign(ensure(r._id), { totalRevenue: _safeNum(r.totalRevenue), totalKgSold: _safeNum(r.totalKgSold), cashAmount: _safeNum(r.cashAmount), posAmount: _safeNum(r.posAmount), transferAmount: _safeNum(r.transferAmount), dailyCloseCount: _safeNum(r.dailyCloseCount) }));
  (expenseRows || []).forEach((r) => { ensure(r._id).totalExpenses += _safeNum(r.totalExpenses); });
  (currentStockRows || []).forEach((r) => Object.assign(ensure(r._id), { currentStockKg: _safeNum(r.currentStockKg), inventoryValue: _safeNum(r.inventoryValue) }));
  (movementRows || []).forEach((r) => {
    const row = ensure(r._id?.branchId);
    const type = String(r._id?.movementType || '');
    if (['SALE_DEPLETION', 'ORDER_DEPLETION'].includes(type)) row.cogs += _safeNum(r.totalCost);
    if (type === 'RECONCILIATION_VARIANCE') { row.stockLossKg += _safeNum(r.quantityKg); row.stockLossValue += _safeNum(r.totalCost); }
  });
  return Array.from(map.values()).map((r) => {
    const grossProfit = r.totalRevenue - r.cogs;
    const netContribution = grossProfit - r.totalExpenses - r.stockLossValue;
    return {
      ...r,
      totalRevenue: _round(r.totalRevenue, 2),
      totalKgSold: _round(r.totalKgSold, 3),
      cogs: _round(r.cogs, 2),
      grossProfit: _round(grossProfit, 2),
      grossMarginPct: r.totalRevenue > 0 ? _round((grossProfit / r.totalRevenue) * 100, 2) : 0,
      totalExpenses: _round(r.totalExpenses, 2),
      stockLossValue: _round(r.stockLossValue, 2),
      netContribution: _round(netContribution, 2),
      profitPerKg: r.totalKgSold > 0 ? _round(netContribution / r.totalKgSold, 2) : 0,
      stockDaysRemaining: r.totalKgSold > 0 ? _round(r.currentStockKg / (r.totalKgSold / _daysBetween(start, end)), 1) : 0,
    };
  }).sort((a, b) => _safeNum(b.netContribution) - _safeNum(a.netContribution));
};

/** GET /api/v2/analytics/gas-plant-dashboard */
const getGasPlantDashboard = async (req, res, next) => {
  try {
    const { period = 'allTime', startDate, endDate, branchId, serviceZoneId } = req.query;
    const branchKey = branchId || serviceZoneId || null;
    const { start, end } = getDateRange(period, startDate, endDate);
    const previous = getPreviousRange(start, end);
    const branchMatch = buildBranchOrZoneMatch(branchKey);

    const [current, prev, monthlyTrend, branchPerformance] = await Promise.all([
      _getOperationalSummary({ start, end, branchMatch }),
      _getOperationalSummary({ start: previous.start, end: previous.end, branchMatch }),
      _getMonthlyTrend({ start, end, branchMatch }),
      _getBranchPerformanceSummary({ start, end, branchMatch }),
    ]);

    const quarterlyTrend = _toQuarterlyTrend(monthlyTrend);
    const growth = {
      revenuePct: _round(_pctChange(current.totalRevenue, prev.totalRevenue), 2),
      kgSoldPct: _round(_pctChange(current.totalKgSold, prev.totalKgSold), 2),
      grossProfitPct: _round(_pctChange(current.grossProfit, prev.grossProfit), 2),
      netContributionPct: _round(_pctChange(current.netContribution, prev.netContribution), 2),
      expensePct: _round(_pctChange(current.totalExpenses, prev.totalExpenses), 2),
      stockLossPct: _round(_pctChange(current.stockLossValue, prev.stockLossValue), 2),
    };

    return res.status(200).json({
      period: { selected: period, start, end, previous },
      branch: { branchId: branchKey },
      current,
      previous: prev,
      growth,
      monthlyTrend,
      quarterlyTrend,
      branchPerformance,
      controls: {
        dataSource: 'OPERATIONAL_PLUS_GL_STATUS',
        dateRule: 'Sales use DailySummary.date, expenses use ExpenseTransaction.date, stock purchases use StockIn.purchaseDate, and stock movements use StockMovement.movementDate. Upload/import dates are not used for performance periods.',
        postingRule: 'Migration imports operational records first. GL posting is performed later by /api/v2/gl/post-approved, /api/v2/gl/rebuild, or /api/v2/gl/retry-failed after finance review and open-period checks.',
        glView: current.postedGL,
        unposted: current.unposted,
        failedPostings: current.failedPostings,
      },
    });
  } catch (error) {
    logger.error('Error fetching gas plant dashboard:', error);
    return next(new HttpError(500, 'Failed to fetch gas plant dashboard.'));
  }
};

// -----------------------------------------------------------------------------
// Existing dashboard/sales endpoints, hardened
// -----------------------------------------------------------------------------
const getDashboardKpis = async (req, res, next) => {
  try {
    const { period = 'monthly', startDate, endDate, branchId, serviceZoneId } = req.query;
    const branchKey = branchId || serviceZoneId || null;
    const { start, end } = getDateRange(period, startDate, endDate);
    const branchMatch = buildBranchOrZoneMatch(branchKey);

    const [ordersAgg, receivableAgg, posAgg, activeDeliveries, stockAgg] = await Promise.all([
      _aggregateOrders({ start, end, branchMatch }, [
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: '$grandTotal' },
            totalKgSold: { $sum: '$totalKgSold' },
            count: { $sum: 1 },
          },
        },
      ]),
      _aggregateOrdersDeliveredUnpaid({ start, end, branchMatch }, [
        { $group: { _id: null, receivables: { $sum: '$grandTotal' }, count: { $sum: 1 } } },
      ]),
      _aggregateDailySummaries({ start, end, branchMatch }, [
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: '$grandTotal' },
            totalKgSold: { $sum: '$totalKgSold' },
            count: { $sum: 1 },
          },
        },
      ]),
      Run.countDocuments({ overallStatus: { $in: ['Assigned', 'In Progress'] } }),
      Plant.aggregate([{ $group: { _id: null, currentBulkStock: { $sum: { $ifNull: ['$outputToday', 0] } } } }]),
    ]);

    const delivery = ordersAgg[0] || { totalRevenue: 0, totalKgSold: 0, count: 0 };
    const pos = posAgg[0] || { totalRevenue: 0, totalKgSold: 0, count: 0 };
    const ar = receivableAgg[0] || { receivables: 0, count: 0 };
    const stock = stockAgg[0] || { currentBulkStock: 0 };

    const totalRevenue = _safeNum(delivery.totalRevenue) + _safeNum(pos.totalRevenue);
    const totalKgSold = _safeNum(delivery.totalKgSold) + _safeNum(pos.totalKgSold);

    return res.status(200).json({
      totalRevenue,
      totalKgSold,
      currentBulkStock: _safeNum(stock.currentBulkStock, 0),
      activeDeliveries,
      period: { start, end },
      branch: { branchId: branchKey },
      breakdown: {
        deliveryRecognizedRevenue: _safeNum(delivery.totalRevenue),
        posRevenue: _safeNum(pos.totalRevenue),
      },
      receivables: {
        unpaidDelivered: _safeNum(ar.receivables),
        count: _safeNum(ar.count),
        note: 'Delivered but unpaid; NOT included in revenue.',
      },
    });
  } catch (error) {
    logger.error('Error fetching dashboard KPIs:', error);
    return next(new HttpError(500, 'Failed to fetch dashboard data.'));
  }
};

const getSalesReport = async (req, res, next) => {
  try {
    const { period = 'monthly', startDate, endDate, branchId, serviceZoneId } = req.query;
    const branchKey = branchId || serviceZoneId || null;
    const { start, end } = getDateRange(period, startDate, endDate);
    const branchMatch = buildBranchOrZoneMatch(branchKey);

    const groupByMonth = [
      {
        $group: {
          _id: { year: { $year: '$businessDate' }, month: { $month: '$businessDate' } },
          totalRevenue: { $sum: '$grandTotal' },
          totalAmount: { $sum: '$grandTotal' },
          totalKgSold: { $sum: '$totalKgSold' },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ];

    const [ordersMonthly, posMonthly] = await Promise.all([
      _aggregateOrders({ start, end, branchMatch }, groupByMonth),
      _aggregateDailySummaries({ start, end, branchMatch }, groupByMonth),
    ]);

    const merged = _mergeByKey(ordersMonthly, posMonthly, (r) => _yearMonthKey(r?._id?.year, r?._id?.month));
    merged.sort((a, b) => (a._id.year !== b._id.year ? a._id.year - b._id.year : a._id.month - b._id.month));

    return res.status(200).json(merged);
  } catch (error) {
    logger.error('Error fetching sales report:', error);
    return next(new HttpError(500, 'Failed to fetch sales report data.'));
  }
};

const getSalesByPaymentMethod = async (req, res, next) => {
  try {
    const { period = 'monthly', startDate, endDate, branchId, serviceZoneId } = req.query;
    const branchKey = branchId || serviceZoneId || null;
    const { start, end } = getDateRange(period, startDate, endDate);
    const branchMatch = buildBranchOrZoneMatch(branchKey);

    const groupByMethod = [
      {
        $group: {
          _id: '$paymentMethod',
          totalRevenue: { $sum: '$grandTotal' },
          totalAmount: { $sum: '$grandTotal' },
          totalKgSold: { $sum: '$totalKgSold' },
          count: { $sum: 1 },
        },
      },
    ];

    const [ordersByMethod, posByMethod] = await Promise.all([
      _aggregateOrders({ start, end, branchMatch }, groupByMethod),
      _aggregateDailySummaries({ start, end, branchMatch }, groupByMethod),
    ]);

    const merged = _mergeByKey(ordersByMethod, posByMethod, (r) => String(r._id || 'Unknown'));
    merged.sort((a, b) => _safeNum(b.totalRevenue) - _safeNum(a.totalRevenue));

    return res.status(200).json(merged);
  } catch (error) {
    logger.error('Error fetching sales by payment method:', error);
    return next(new HttpError(500, 'Failed to fetch sales by payment method.'));
  }
};

const getSalesByBranch = async (req, res, next) => {
  try {
    const { period = 'monthly', startDate, endDate, branchId, serviceZoneId } = req.query;
    const branchKey = branchId || serviceZoneId || null;
    const { start, end } = getDateRange(period, startDate, endDate);
    const branchMatch = buildBranchOrZoneMatch(branchKey);

    const groupByBranch = [
      {
        $group: {
          _id: '$branchId',
          totalRevenue: { $sum: '$grandTotal' },
          totalAmount: { $sum: '$grandTotal' },
          totalKgSold: { $sum: '$totalKgSold' },
          count: { $sum: 1 },
        },
      },
    ];

    const [ordersByBranch, posByBranch, plantMap] = await Promise.all([
      _aggregateOrders({ start, end, branchMatch }, groupByBranch),
      _aggregateDailySummaries({ start, end, branchMatch }, groupByBranch),
      _loadPlantMap(),
    ]);

    const merged = _mergeByKey(ordersByBranch, posByBranch, (r) => String(r._id || 'Unknown'));

    const shaped = merged.map((r) => ({
      branchId: r._id,
      branchName: plantMap.get(String(r._id)) || null,
      totalRevenue: _safeNum(r.totalRevenue),
      totalAmount: _safeNum(r.totalRevenue),
      totalKgSold: _safeNum(r.totalKgSold),
      count: _safeNum(r.count),
    }));

    shaped.sort((a, b) => _safeNum(b.totalRevenue) - _safeNum(a.totalRevenue));
    return res.status(200).json(shaped);
  } catch (error) {
    logger.error('Error fetching sales by branch:', error);
    return next(new HttpError(500, 'Failed to fetch sales by branch.'));
  }
};

const getTopSellingProducts = async (req, res, next) => {
  try {
    const { period = 'monthly', startDate, endDate, branchId, serviceZoneId } = req.query;
    const branchKey = branchId || serviceZoneId || null;
    const { start, end } = getDateRange(period, startDate, endDate);
    const branchMatch = buildBranchOrZoneMatch(branchKey);

    const ordersTop = await _aggregateOrders({ start, end, branchMatch }, [
      { $unwind: { path: '$items', preserveNullAndEmptyArrays: false } },
      {
        $group: {
          _id: '$items.productName',
          totalQuantitySold: { $sum: '$items.quantity' },
          totalRevenue: { $sum: { $multiply: ['$items.quantity', '$items.unitPrice'] } },
          count: { $sum: 1 },
        },
      },
    ]);

    const posTop = await _aggregateDailySummaries({ start, end, branchMatch }, [
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.productName',
          totalQuantitySold: { $sum: '$items.quantity' },
          totalRevenue: { $sum: { $multiply: ['$items.quantity', '$items.unitPrice'] } },
          count: { $sum: 1 },
        },
      },
    ]);

    const map = new Map();
    const addRow = (r) => {
      const k = String(r._id || 'Unknown');
      const prev = map.get(k) || { _id: k, productName: k, totalQuantitySold: 0, totalRevenue: 0, count: 0 };
      map.set(k, {
        _id: k,
        productName: k,
        totalQuantitySold: _safeNum(prev.totalQuantitySold) + _safeNum(r.totalQuantitySold),
        totalRevenue: _safeNum(prev.totalRevenue) + _safeNum(r.totalRevenue),
        count: _safeNum(prev.count) + _safeNum(r.count),
      });
    };

    (ordersTop || []).forEach(addRow);
    (posTop || []).forEach(addRow);

    const merged = Array.from(map.values()).sort(
      (a, b) => _safeNum(b.totalRevenue) - _safeNum(a.totalRevenue)
    );

    return res.status(200).json(merged.slice(0, 10));
  } catch (error) {
    logger.error('Error fetching top selling products:', error);
    return next(new HttpError(500, 'Failed to fetch top selling products.'));
  }
};

// -----------------------------------------------------------------------------
// Wave 14A additions
// -----------------------------------------------------------------------------

/** GET /api/v2/analytics/heatmap */
const getHeatmap = async (req, res, next) => {
  try {
    const { period = 'monthly', startDate, endDate, branchId, serviceZoneId, mode = 'revenue', limit = 2000 } = req.query;
    const branchKey = branchId || serviceZoneId || null;
    const { start, end } = getDateRange(period, startDate, endDate);
    const branchMatch = buildBranchOrZoneMatch(branchKey);
    const max = Math.min(Math.max(parseInt(limit, 10) || 2000, 1), 5000);

    const rows = await _aggregateOrders({ start, end, branchMatch }, [
      { $match: { lat: { $ne: null }, lng: { $ne: null } } },
      {
        $project: {
          id: '$orderId',
          lat: 1,
          lng: 1,
          weight: mode === 'volume' ? { $literal: 1 } : '$grandTotal',
          amount: '$grandTotal',
          businessDate: 1,
          branchId: 1,
        },
      },
      { $sort: { weight: -1 } },
      { $limit: max },
    ]);

    return res.status(200).json(rows);
  } catch (error) {
    logger.error('Error fetching heatmap analytics:', error);
    return next(new HttpError(500, 'Failed to fetch heatmap analytics.'));
  }
};

/** GET /api/v2/analytics/business-metrics */
const getBusinessMetrics = async (req, res, next) => {
  try {
    const { period = 'monthly', startDate, endDate, branchId, serviceZoneId } = req.query;
    const branchKey = branchId || serviceZoneId || null;
    const { start, end } = getDateRange(period, startDate, endDate);
    const previous = getPreviousRange(start, end);
    const branchMatch = buildBranchOrZoneMatch(branchKey);

    const orderGroup = [
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$grandTotal' },
          orderCount: { $sum: 1 },
          uniqueCustomers: { $addToSet: '$customerId' },
        },
      },
      {
        $project: {
          _id: 0,
          totalRevenue: 1,
          orderCount: 1,
          uniqueCustomerCount: { $size: '$uniqueCustomers' },
        },
      },
    ];

    const [totalCustomers, newCustomers, prevNewCustomers, currentOrders, prevOrders, acquisitionTrend, repeatRows] = await Promise.all([
      User.countDocuments({ role: 'customer' }),
      User.countDocuments({ role: 'customer', createdAt: { $gte: start, $lte: end } }),
      User.countDocuments({ role: 'customer', createdAt: { $gte: previous.start, $lte: previous.end } }),
      _aggregateOrders({ start, end, branchMatch }, orderGroup),
      _aggregateOrders({ start: previous.start, end: previous.end, branchMatch }, orderGroup),
      User.aggregate([
        { $match: { role: 'customer', createdAt: { $gte: start, $lte: end } } },
        { $group: { _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } }, value: { $sum: 1 } } },
        { $sort: { '_id.year': 1, '_id.month': 1 } },
        { $project: { _id: 0, label: { $concat: [{ $toString: '$_id.year' }, '-', { $toString: '$_id.month' }] }, value: 1 } },
      ]),
      _aggregateOrders({ start, end, branchMatch }, [
        { $group: { _id: '$customerId', orderCount: { $sum: 1 } } },
        { $match: { orderCount: { $gte: 2 } } },
        { $count: 'repeatCustomers' },
      ]),
    ]);

    const cur = currentOrders[0] || { totalRevenue: 0, orderCount: 0, uniqueCustomerCount: 0 };
    const prev = prevOrders[0] || { totalRevenue: 0, orderCount: 0, uniqueCustomerCount: 0 };
    const activeCustomers = _safeNum(cur.uniqueCustomerCount, 0);
    const previousActiveCustomers = _safeNum(prev.uniqueCustomerCount, 0);
    const repeatCustomers = _safeNum(repeatRows?.[0]?.repeatCustomers, 0);

    const avgOrderValue = cur.orderCount > 0 ? cur.totalRevenue / cur.orderCount : 0;
    const prevAov = prev.orderCount > 0 ? prev.totalRevenue / prev.orderCount : 0;
    const ltv = activeCustomers > 0 ? cur.totalRevenue / activeCustomers : 0;
    const prevLtv = previousActiveCustomers > 0 ? prev.totalRevenue / previousActiveCustomers : 0;
    const repeatPurchaseRate = activeCustomers > 0 ? (repeatCustomers / activeCustomers) * 100 : 0;
    const churnRate = previousActiveCustomers > 0
      ? Math.max(0, ((previousActiveCustomers - activeCustomers) / previousActiveCustomers) * 100)
      : 0;

    return res.status(200).json({
      period: { start, end, previous },
      branch: { branchId: branchKey },
      totalCustomers,
      newCustomers,
      churnRate: _round(churnRate, 2),
      avgOrderValue: _round(avgOrderValue, 2),
      ltv: _round(ltv, 2),
      repeatPurchaseRate: _round(repeatPurchaseRate, 2),
      acquisitionTrend: (acquisitionTrend || []).map((x) => ({ ...x, label: String(x.label || '').replace(/-(\d)$/, '-0$1') })),
      orderCount: _safeNum(cur.orderCount),
      activeCustomers,
      totalRevenue: _safeNum(cur.totalRevenue),
      customerTrendPct: _round(_pctChange(newCustomers, prevNewCustomers), 2),
      churnTrendPct: _round(_pctChange(churnRate, 0), 2),
      aovTrendPct: _round(_pctChange(avgOrderValue, prevAov), 2),
      ltvTrendPct: _round(_pctChange(ltv, prevLtv), 2),
      calculationNotes: [
        'LTV is period revenue divided by active buying customers for the selected period.',
        'Churn is directional because explicit churn events are not yet modeled.',
      ],
    });
  } catch (error) {
    logger.error('Error fetching business metrics:', error);
    return next(new HttpError(500, 'Failed to fetch business metrics.'));
  }
};

/** GET /api/v2/analytics/driver-performance */
const getDriverPerformance = async (req, res, next) => {
  try {
    const { period = 'monthly', startDate, endDate, branchId, serviceZoneId, driverId } = req.query;
    const branchKey = branchId || serviceZoneId || null;
    const { start, end } = getDateRange(period, startDate, endDate);
    const branchMatch = buildBranchOrZoneMatch(branchKey);

    const runMatch = {
      createdAt: { $gte: start, $lte: end },
      ...(driverId ? { driverId: String(driverId) } : {}),
    };

    const [runs, revenueRows, users] = await Promise.all([
      Run.find(runMatch).lean(),
      _aggregateOrders({ start, end, branchMatch }, [
        ...(driverId ? [{ $match: { driverId: String(driverId) } }] : []),
        { $group: { _id: '$driverId', revenueGenerated: { $sum: '$grandTotal' }, deliveredOrders: { $sum: 1 } } },
      ]),
      User.find({ role: 'driver' }).lean(),
    ]);

    const userMap = new Map((users || []).map((u) => [String(u.id), u]));
    const revenueMap = new Map((revenueRows || []).map((r) => [String(r._id || ''), r]));
    const map = new Map();

    for (const run of runs || []) {
      const key = String(run.driverId || 'UNASSIGNED');
      const prev = map.get(key) || {
        id: key,
        driverId: key,
        totalRuns: 0,
        totalStops: 0,
        completedStops: 0,
        failedStops: 0,
        activeRuns: 0,
        completedRuns: 0,
        totalDeliveryMinutes: 0,
        timedRuns: 0,
      };

      const stops = Array.isArray(run.stops) ? run.stops : [];
      const failedStatuses = ['CUSTOMER_UNAVAILABLE', 'ISSUE_REPORTED', 'CANCELED'];
      const completed = stops.filter((s) => String(s.status || '').toUpperCase() === 'DELIVERED').length;
      const failed = stops.filter((s) => failedStatuses.includes(String(s.status || '').toUpperCase())).length;

      prev.totalRuns += 1;
      prev.totalStops += stops.length;
      prev.completedStops += completed;
      prev.failedStops += failed;
      if (['Assigned', 'In Progress'].includes(run.overallStatus)) prev.activeRuns += 1;
      if (['Completed', 'Partially Completed'].includes(run.overallStatus)) prev.completedRuns += 1;

      const startTime = run.actualStartDate || run.estimatedStartDate;
      const endTime = run.actualCompletionDate;
      if (startTime && endTime) {
        const minutes = (new Date(endTime).getTime() - new Date(startTime).getTime()) / 60000;
        if (Number.isFinite(minutes) && minutes > 0) {
          prev.totalDeliveryMinutes += minutes;
          prev.timedRuns += 1;
        }
      }

      map.set(key, prev);
    }

    // Include drivers who generated order revenue even if no run was found in range.
    for (const [key] of revenueMap.entries()) {
      if (key && key !== 'null' && !map.has(key)) {
        map.set(key, {
          id: key,
          driverId: key,
          totalRuns: 0,
          totalStops: 0,
          completedStops: 0,
          failedStops: 0,
          activeRuns: 0,
          completedRuns: 0,
          totalDeliveryMinutes: 0,
          timedRuns: 0,
        });
      }
    }

    const drivers = Array.from(map.values()).map((d) => {
      const u = userMap.get(String(d.driverId)) || {};
      const rev = revenueMap.get(String(d.driverId)) || {};
      const onTimeRate = d.totalStops > 0 ? (d.completedStops / d.totalStops) * 100 : 0;
      return {
        ...d,
        name: u.name || (d.driverId === 'UNASSIGNED' ? 'Unassigned' : `Driver ${String(d.driverId).slice(-6)}`),
        phone: u.phone || null,
        rating: _safeNum(u?.driverProfile?.averageRating, 0),
        ratingCount: _safeNum(u?.driverProfile?.ratingCount, 0),
        vehicleModel: u?.driverProfile?.vehicleType || u?.driverProfile?.licensePlate || 'Fleet Vehicle',
        totalDeliveries: _safeNum(d.completedStops, 0),
        issuesReported: _safeNum(d.failedStops, 0),
        onTimeRate: _round(onTimeRate, 1),
        avgDeliveryTimeMinutes: d.timedRuns > 0 ? Math.round(d.totalDeliveryMinutes / d.timedRuns) : 0,
        revenueGenerated: _safeNum(rev.revenueGenerated, 0),
      };
    });

    drivers.sort((a, b) => {
      const d1 = _safeNum(b.totalDeliveries) - _safeNum(a.totalDeliveries);
      if (d1 !== 0) return d1;
      const r1 = _safeNum(b.rating) - _safeNum(a.rating);
      if (r1 !== 0) return r1;
      return _safeNum(b.revenueGenerated) - _safeNum(a.revenueGenerated);
    });

    return res.status(200).json({
      period: { start, end },
      branch: { branchId: branchKey },
      summary: {
        driverCount: drivers.length,
        totalDeliveries: drivers.reduce((s, d) => s + _safeNum(d.totalDeliveries), 0),
        failedStops: drivers.reduce((s, d) => s + _safeNum(d.failedStops), 0),
        revenueGenerated: drivers.reduce((s, d) => s + _safeNum(d.revenueGenerated), 0),
      },
      drivers,
    });
  } catch (error) {
    logger.error('Error fetching driver performance analytics:', error);
    return next(new HttpError(500, 'Failed to fetch driver performance analytics.'));
  }
};

/** GET /api/v2/analytics/branch-performance */
const getBranchPerformance = async (req, res, next) => {
  try {
    const { period = 'monthly', startDate, endDate, branchId, serviceZoneId } = req.query;
    const branchKey = branchId || serviceZoneId || null;
    const { start, end } = getDateRange(period, startDate, endDate);
    const branchMatch = buildBranchOrZoneMatch(branchKey);

    const [salesRows, dailyRows, glRows, plantMap] = await Promise.all([
      Promise.all([
        _aggregateOrders({ start, end, branchMatch }, [
          { $group: { _id: '$branchId', revenue: { $sum: '$grandTotal' }, kg: { $sum: '$totalKgSold' }, deliveryOrders: { $sum: 1 } } },
        ]),
        _aggregateDailySummaries({ start, end, branchMatch }, [
          { $group: { _id: '$branchId', posRevenue: { $sum: '$grandTotal' }, kg: { $sum: '$totalKgSold' }, dailyCloses: { $sum: 1 } } },
        ]),
      ]),
      DailySummary.aggregate([
        { $match: _dailySummaryMatch(start, end, branchMatch) },
        {
          $group: {
            _id: '$branchId',
            expenses: { $sum: { $ifNull: ['$expenses.total', 0] } },
            cashSales: { $sum: { $ifNull: ['$sales.cashAmount', 0] } },
            posSales: { $sum: { $ifNull: ['$sales.posAmount', 0] } },
            transferSales: { $sum: { $ifNull: ['$sales.transferAmount', 0] } },
          },
        },
      ]),
      GeneralLedgerEntry.aggregate([
        { $match: { date: { $gte: start, $lte: end }, status: 'POSTED', ...(branchKey ? { branchKey: String(branchKey) } : {}) } },
        { $group: { _id: '$branchKey', postedJournals: { $sum: 1 }, totalDebits: { $sum: '$totals.debit' }, totalCredits: { $sum: '$totals.credit' } } },
      ]).catch(() => []),
      _loadPlantMap(),
    ]);

    const [ordersByBranch, posByBranch] = salesRows;
    const map = new Map();

    const ensure = (key) => {
      const k = String(key || 'Unknown');
      if (!map.has(k)) {
        map.set(k, {
          branchId: key || 'Unknown',
          branchName: plantMap.get(k) || null,
          deliveryRevenue: 0,
          posRevenue: 0,
          totalRevenue: 0,
          totalKgSold: 0,
          deliveryOrders: 0,
          dailyCloses: 0,
          expenses: 0,
          netContribution: 0,
          cashSales: 0,
          posSales: 0,
          transferSales: 0,
          postedJournals: 0,
          glBalanced: true,
        });
      }
      return map.get(k);
    };

    (ordersByBranch || []).forEach((r) => {
      const row = ensure(r._id);
      row.deliveryRevenue += _safeNum(r.revenue);
      row.totalRevenue += _safeNum(r.revenue);
      row.totalKgSold += _safeNum(r.kg);
      row.deliveryOrders += _safeNum(r.deliveryOrders);
    });

    (posByBranch || []).forEach((r) => {
      const row = ensure(r._id);
      row.posRevenue += _safeNum(r.posRevenue);
      row.totalRevenue += _safeNum(r.posRevenue);
      row.totalKgSold += _safeNum(r.kg);
      row.dailyCloses += _safeNum(r.dailyCloses);
    });

    (dailyRows || []).forEach((r) => {
      const row = ensure(r._id);
      row.expenses += _safeNum(r.expenses);
      row.cashSales += _safeNum(r.cashSales);
      row.posSales += _safeNum(r.posSales);
      row.transferSales += _safeNum(r.transferSales);
    });

    (glRows || []).forEach((r) => {
      const row = ensure(r._id);
      row.postedJournals += _safeNum(r.postedJournals);
      row.glBalanced = Math.abs(_safeNum(r.totalDebits) - _safeNum(r.totalCredits)) < 0.01;
    });

    const rows = Array.from(map.values()).map((r) => ({
      ...r,
      grossProfit: r.totalRevenue, // COGS is not fully active yet
      netContribution: r.totalRevenue - r.expenses,
      avgRevenuePerKg: r.totalKgSold > 0 ? _round(r.totalRevenue / r.totalKgSold, 2) : 0,
    }));

    rows.sort((a, b) => _safeNum(b.totalRevenue) - _safeNum(a.totalRevenue));

    return res.status(200).json({ period: { start, end }, rows });
  } catch (error) {
    logger.error('Error fetching branch performance analytics:', error);
    return next(new HttpError(500, 'Failed to fetch branch performance analytics.'));
  }
};

/** GET /api/v2/analytics/daily-close-performance */
const getDailyClosePerformance = async (req, res, next) => {
  try {
    const { period = 'monthly', startDate, endDate, branchId, serviceZoneId } = req.query;
    const branchKey = branchId || serviceZoneId || null;
    const { start, end } = getDateRange(period, startDate, endDate);
    const branchMatch = buildBranchOrZoneMatch(branchKey);
    const todayStart = _startOfDay(new Date());

    const [statusRows, varianceRows, staleRows, failedPostingRows, ticketRows] = await Promise.all([
      DailySummary.aggregate([
        { $match: { ...branchMatch, date: { $gte: start, $lte: end } } },
        { $group: { _id: '$status', count: { $sum: 1 }, revenue: { $sum: { $ifNull: ['$sales.totalRevenue', 0] } } } },
      ]),
      DailySummary.aggregate([
        { $match: { ...branchMatch, date: { $gte: start, $lte: end } } },
        {
          $group: {
            _id: null,
            avgVariance: { $avg: { $abs: { $ifNull: ['$reconciliation.discrepancy', 0] } } },
            totalVariance: { $sum: { $ifNull: ['$reconciliation.discrepancy', 0] } },
          },
        },
      ]),
      DailySummary.find({ ...branchMatch, date: { $lt: todayStart }, status: { $in: ['in_progress', 'pending_approval', 'rejected'] } })
        .sort({ date: 1 })
        .limit(20)
        .lean(),
      DailySummary.countDocuments({ ...branchMatch, date: { $gte: start, $lte: end }, 'posting.status': 'FAILED' }),
      SupportTicket.countDocuments({ createdAt: { $gte: start, $lte: end }, status: { $in: ['OPEN', 'IN_PROGRESS', 'ESCALATED'] } }).catch(() => 0),
    ]);

    const counts = {
      inProgress: 0,
      pendingApproval: 0,
      approved: 0,
      posted: 0,
      closed: 0,
      rejected: 0,
      total: 0,
      totalRevenue: 0,
    };

    for (const r of statusRows || []) {
      const status = String(r._id || '').toLowerCase();
      const c = _safeNum(r.count);
      counts.total += c;
      counts.totalRevenue += _safeNum(r.revenue);
      if (status === 'in_progress') counts.inProgress += c;
      else if (status === 'pending_approval') counts.pendingApproval += c;
      else if (status === 'approved') counts.approved += c;
      else if (status === 'posted') counts.posted += c;
      else if (status === 'closed') counts.closed += c;
      else if (status === 'rejected') counts.rejected += c;
    }

    const approvedButUnposted = await DailySummary.countDocuments({
      ...branchMatch,
      date: { $gte: start, $lte: end },
      status: 'approved',
      'posting.status': { $in: ['UNPOSTED', 'QUEUED', 'FAILED'] },
    });

    const staleOpenDays = (staleRows || []).map((d) => ({
      dailySummaryId: d.dailySummaryId,
      date: d.date,
      branchId: d.branchId,
      cashierName: d.cashierName,
      status: d.status,
      revenue: _safeNum(d?.sales?.totalRevenue),
    }));

    const completionRate = counts.total > 0 ? ((counts.posted + counts.closed) / counts.total) * 100 : 0;
    const variance = varianceRows[0] || { avgVariance: 0, totalVariance: 0 };

    return res.status(200).json({
      period: { start, end },
      branch: { branchId: branchKey },
      counts,
      completionRate: _round(completionRate, 1),
      approvedButUnposted,
      failedPostings: failedPostingRows,
      overdueOpenDays: staleOpenDays.length,
      staleOpenDays,
      avgVariance: _round(variance.avgVariance, 2),
      totalVariance: _round(variance.totalVariance, 2),
      openSupportTickets: ticketRows,
      alerts: {
        hasUnfinalizedPriorDays: staleOpenDays.length > 0,
        hasApprovedButUnposted: approvedButUnposted > 0,
        hasFailedPostings: failedPostingRows > 0,
      },
    });
  } catch (error) {
    logger.error('Error fetching daily close analytics:', error);
    return next(new HttpError(500, 'Failed to fetch daily close analytics.'));
  }
};

module.exports = {
  getGasPlantDashboard,
  getDashboardKpis,
  getSalesReport,
  getSalesByPaymentMethod,
  getSalesByBranch,
  getTopSellingProducts,
  getHeatmap,
  getBusinessMetrics,
  getDriverPerformance,
  getBranchPerformance,
  getDailyClosePerformance,
};
