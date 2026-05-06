// src/api/v2/data-entry/data-entry.service.js
const DailySummary = require('../../../models/dailySummary.model');
const SaleTransaction = require('../../../models/saleTransaction.model');
const ExpenseTransaction = require('../../../models/expenseTransaction.model');
const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');
const HttpError = require('../../../utils/HttpError');
const DailyCloseAudit = require('../../../models/dailyCloseAudit.model');
const { lookupEffectivePrice } = require('../inventory/services/productPricing.service');
const { validatePosSaleBeforeLog } = require('../control/operationalValidation.service');
const priceOverrideService = require('../pricing/priceOverride.service');

const parseBusinessDate = (date) => {
  if (!date) return new Date();
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
  }
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};
const startOfDay = (date) => {
  const d = parseBusinessDate(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
};
const endOfDay = (date) => {
  const d = parseBusinessDate(date);
  d.setUTCHours(23, 59, 59, 999);
  return d;
};
const receiptNumberFor = (doc, prefix = 'PJ') => {
  const raw = doc?.receiptNumber || doc?._id || doc?.id || Date.now();
  return `${prefix}-${String(raw).slice(-8).toUpperCase()}`;
};
const safeNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const normalizePaymentMethod = (v) => {
  const s = String(v || '').toUpperCase().trim();
  if (s.includes('TRANSFER') || s.includes('BANK')) return 'TRANSFER';
  if (s.includes('POS') || s.includes('CARD')) return 'POS';
  return 'CASH';
};
const normalizeExpenseCategory = (v) => {
  const s = String(v || 'ADMIN').toUpperCase().trim();
  if (s.includes('STAFF') || s.includes('SALAR')) return s.includes('SALAR') ? 'SALARIES' : 'STAFF';
  if (s.includes('LOGISTICS') || s.includes('TRANSPORT') || s.includes('FUEL')) return s.includes('FUEL') ? 'FUEL' : 'LOGISTICS';
  if (s.includes('UTIL')) return 'UTILITIES';
  if (s.includes('MAINT') || s.includes('REPAIR')) return 'MAINTENANCE';
  if (s.includes('MARKET') || s.includes('ADVERT') || s.includes('PROMO')) return 'MARKETING';
  if (s.includes('MISC')) return 'MISCELLANEOUS';
  return 'ADMIN';
};
const normalizePaymentDisposition = (v) => {
  const s = String(v || 'CASH').toUpperCase().trim();
  if (s.includes('UNPAID') || s === 'AP' || s.includes('PAYABLE')) return 'UNPAID';
  if (s.includes('TRANSFER') || s.includes('BANK')) return 'TRANSFER';
  if (s.includes('POS') || s.includes('CARD')) return 'POS';
  return 'CASH';
};

const auditClose = async ({ summary, action, statusBefore = null, statusAfter = null, performedBy = 'system', reason = null, meta = {} }) => {
  try {
    await DailyCloseAudit.create({
      dailySummaryId: summary?._id || null,
      dailySummaryPublicId: summary?.dailySummaryId || null,
      branchId: summary?.branchId ? String(summary.branchId) : null,
      businessDate: summary?.date || null,
      action,
      statusBefore,
      statusAfter,
      performedBy,
      reason,
      meta,
    });
  } catch (_) {}
};

const isPosted = (summary) => String(summary?.posting?.status || '').toUpperCase() === 'POSTED';
const assertSummaryEditable = (summary, action = 'modify') => {
  if (!summary) throw new HttpError(404, 'Daily summary not found.');
  if (isPosted(summary)) throw new HttpError(400, 'Cannot ' + action + ' a posted daily summary. Reverse the GL journal and reopen through correction workflow.');
  if (String(summary.status || '').toLowerCase() !== 'in_progress') throw new HttpError(400, 'Cannot ' + action + ' daily summary unless status is IN_PROGRESS.');
};

const buildReceiptNumber = (branchId, date, id) => {
  const d = startOfDay(date).toISOString().slice(0, 10).replace(/-/g, '');
  const b = String(branchId || 'BR').slice(-4).toUpperCase();
  const x = String(id || Date.now()).slice(-6).toUpperCase();
  return 'PJ-' + d + '-' + b + '-' + x;
};

const toPlain = (doc) => {
  if (!doc) return doc;
  if (typeof doc.toObject === 'function') return doc.toObject({ virtuals: true });
  return { ...doc };
};

const normalizeSaleForApi = (sale) => {
  const x = toPlain(sale) || {};
  const amount = safeNum(x.totalRevenue ?? x.amount ?? x.revenue, 0);
  const kgSold = safeNum(x.kgSold ?? x.quantity, 0);
  const pricePerKg = safeNum(x.pricePerKg ?? x.unitPrice, kgSold > 0 ? amount / kgSold : 0);
  const paymentMethod = normalizePaymentMethod(x.paymentMethod || x.transactionType);
  return {
    ...x,
    type: 'sale',
    amount,
    revenue: amount,
    totalRevenue: amount,
    kgSold,
    quantity: kgSold,
    unit: 'kg',
    unitPrice: pricePerKg,
    pricePerKg,
    paymentMethod,
    transactionType: paymentMethod,
    receiptNumber: x.receiptNumber || receiptNumberFor(x, 'SALE'),
    cashierEmail: x.cashierEmail || x.cashierName || x.cashierId || null,
  };
};

const normalizeExpenseForApi = (expense) => {
  const x = toPlain(expense) || {};
  const amount = safeNum(x.amount, 0);
  return {
    ...x,
    type: 'expense',
    amount,
    receiptNumber: x.receiptNumber || receiptNumberFor(x, 'EXP'),
  };
};

const normalizeSummaryForApi = (summary) => {
  const x = toPlain(summary) || {};
  const amount = safeNum(x?.sales?.totalRevenue, 0);
  return {
    ...x,
    type: 'Daily Summary',
    sourceType: 'DAILY_SUMMARY',
    description: 'Daily POS sales summary',
    narration: 'Daily POS sales summary' + (x.cashierName ? ' - ' + x.cashierName : ''),
    amount,
    totalRevenue: amount,
    kgSold: safeNum(x?.sales?.totalKgSold, 0),
    paymentSplit: {
      cashAmount: safeNum(x?.sales?.cashAmount, 0),
      transferAmount: safeNum(x?.sales?.transferAmount, 0),
      posAmount: safeNum(x?.sales?.posAmount, 0),
    },
    approvalStatus: x.status,
    posting: x.posting || { status: 'UNPOSTED' },
  };
};

const buildBranchHistoryMatch = (branchId) => {
  if (!branchId) return {};
  const s = String(branchId);
  const ors = [{ branchId: s }, { serviceZoneId: s }, { zoneId: s }, { plantId: s }];
  if (mongoose.Types.ObjectId.isValid(s)) {
    const oid = new mongoose.Types.ObjectId(s);
    ors.push({ branchId: oid }, { serviceZoneId: oid }, { zoneId: oid }, { plantId: oid });
  }
  return { $or: ors };
};

const findSummaryByAnyId = async (summaryId) => {
  if (!summaryId) return null;
  if (mongoose.Types.ObjectId.isValid(String(summaryId))) {
    const byObjectId = await DailySummary.findById(summaryId);
    if (byObjectId) return byObjectId;
  }
  return DailySummary.findOne({ dailySummaryId: String(summaryId) });
};

const findSummaryByAnyIdLean = async (summaryId, populate = false) => {
  let q;
  if (mongoose.Types.ObjectId.isValid(String(summaryId))) q = DailySummary.findById(summaryId);
  else q = DailySummary.findOne({ dailySummaryId: String(summaryId) });
  if (populate) q = q.populate('sales.items').populate('expenses.items');
  return q.lean();
};

const createOrGetDailySummary = async ({ branchId, cashierName, pricePerKg, userId, date }) => {
  const businessDate = startOfDay(date || new Date());
  const businessDateKey = businessDate.toISOString().slice(0, 10);
  let dailySummary = await DailySummary.findOne({
    branchId,
    $or: [
      { businessDateKey },
      { date: { $gte: startOfDay(businessDate), $lte: endOfDay(businessDate) } },
    ],
  }).sort({ updatedAt: -1 });

  if (dailySummary) {
    if (cashierName) dailySummary.cashierName = cashierName;
    if (pricePerKg) dailySummary.pricePerKg = safeNum(pricePerKg, dailySummary.pricePerKg || 0.01);
    await dailySummary.save();
    return dailySummary;
  }

  dailySummary = new DailySummary({
    dailySummaryId: uuidv4(),
    date: businessDate,
    businessDateKey,
    branchId,
    cashierName: cashierName || 'System Cashier',
    pricePerKg: safeNum(pricePerKg, 0.01),
    status: 'in_progress',
    openingMeters: { meterA: 0, meterB: 0 },
    closingMeters: { meterA: 0, meterB: 0 },
    sales: { totalRevenue: 0, totalKgSold: 0, posAmount: 0, cashAmount: 0, transferAmount: 0, items: [] },
    expenses: { total: 0, items: [] },
    reconciliation: { calculatedRevenue: 0, discrepancy: 0 },
    managerApproval: {},
    createdBy: userId || null,
  });
  try {
    await dailySummary.save();
  } catch (error) {
    if (error && error.code === 11000) {
      return DailySummary.findOne({ branchId, businessDateKey }).sort({ updatedAt: -1 });
    }
    throw error;
  }
  return dailySummary;
};

const updateSummaryMeters = async (summaryId, metersData) => {
  const summary = await findSummaryByAnyId(summaryId);
  if (!summary) throw new HttpError(404, 'Daily summary not found.');
  assertSummaryEditable(summary, 'update meters for');

  summary.openingMeters = metersData.openingMeters || summary.openingMeters;
  summary.closingMeters = metersData.closingMeters || summary.closingMeters;
  if (metersData.pricePerKg) summary.pricePerKg = safeNum(metersData.pricePerKg, summary.pricePerKg);

  const meterA = safeNum(summary.closingMeters?.meterA, 0) - safeNum(summary.openingMeters?.meterA, 0);
  const meterB = safeNum(summary.closingMeters?.meterB, 0) - safeNum(summary.openingMeters?.meterB, 0);
  summary.reconciliation.calculatedRevenue = (meterA + meterB) * safeNum(summary.pricePerKg, 0);
  summary.reconciliation.discrepancy = safeNum(summary.sales?.totalRevenue, 0) - summary.reconciliation.calculatedRevenue;
  await summary.save();
  return summary;
};

const createSaleEntry = async (saleData) => {
  const summary = await findSummaryByAnyId(saleData.dailySummaryId);
  if (!summary) throw new HttpError(404, 'Daily summary not found.');
  assertSummaryEditable(summary, 'add sale entries to');

  const paymentMethod = normalizePaymentMethod(saleData.paymentMethod || saleData.transactionType);
  const kgSold = safeNum(saleData.kgSold ?? saleData.quantity, 0);
  const branchKey = saleData.branchId || summary.branchId;
  const priceLookup = await lookupEffectivePrice({
    branchId: String(branchKey),
    productId: saleData.productId || saleData.productSku,
    productSku: saleData.productSku,
    businessDate: saleData.date || summary.date || new Date(),
  }).catch(() => null);

  const configuredPricePerKg = safeNum(priceLookup?.pricePerKg, 0);
  const enteredPricePerKg = safeNum(saleData.pricePerKg ?? saleData.unitPrice, 0);
  const pricePerKg = enteredPricePerKg > 0 ? enteredPricePerKg : (configuredPricePerKg > 0 ? configuredPricePerKg : safeNum(summary.pricePerKg, 0));
  const totalRevenue = safeNum(saleData.totalRevenue ?? saleData.amount ?? saleData.revenue ?? kgSold * pricePerKg, 0);
  if (kgSold <= 0 || totalRevenue <= 0 || pricePerKg <= 0) throw new HttpError(400, 'kgSold, pricePerKg and totalRevenue must be greater than zero.');

  await validatePosSaleBeforeLog({
    branchId: String(branchKey),
    productId: saleData.productId || priceLookup?.productId,
    productSku: saleData.productSku || priceLookup?.productSku,
    kgSold,
    pricePerKg,
    amount: totalRevenue,
    paymentMethod,
    businessDate: saleData.date || summary.date || new Date(),
  });

  const overrideTolerance = safeNum(saleData.overrideTolerance, 0.01);
  const isOverride = configuredPricePerKg > 0 && Math.abs(pricePerKg - configuredPricePerKg) > overrideTolerance;
  if (isOverride && !saleData.overrideReason && saleData.requireOverrideReason !== false) {
    throw new HttpError(400, `Price override detected. Configured price is ${configuredPricePerKg}; entered price is ${pricePerKg}. Provide overrideReason.`);
  }

  let approvedOverride = null;
  if (isOverride) {
    try {
      approvedOverride = await priceOverrideService.assertApprovedOverrideForSale({
        overrideId: saleData.priceOverrideRequestId || saleData.overrideApprovalId,
        branchId: String(branchKey),
        productId: priceLookup?.productId || saleData.productId || null,
        productSku: priceLookup?.productSku || saleData.productSku || null,
        requestedPricePerKg: pricePerKg,
        businessDate: saleData.date || summary.date || new Date(),
      });
    } catch (error) {
      error.details = {
        ...(error.details || {}),
        code: 'PRICE_OVERRIDE_APPROVAL_REQUIRED',
        branchId: String(branchKey),
        productId: priceLookup?.productId || saleData.productId || null,
        productSku: priceLookup?.productSku || saleData.productSku || null,
        configuredPricePerKg,
        requestedPricePerKg: pricePerKg,
        reason: saleData.overrideReason || null,
      };
      throw error;
    }
  }

  const split = { cashAmount: 0, transferAmount: 0, posAmount: 0 };
  if (paymentMethod === 'CASH') split.cashAmount = totalRevenue;
  if (paymentMethod === 'TRANSFER') split.transferAmount = totalRevenue;
  if (paymentMethod === 'POS') split.posAmount = totalRevenue;

  const sale = await SaleTransaction.create({
    branchId: branchKey,
    dailySummaryId: summary._id,
    date: saleData.date || summary.date || new Date(),
    productId: priceLookup?.productId || saleData.productId || null,
    productSku: priceLookup?.productSku || saleData.productSku || null,
    productName: priceLookup?.productName || saleData.productName || null,
    kgSold,
    pricePerKg,
    totalRevenue,
    ...split,
    paymentMethod,
    priceOverride: {
      isOverride,
      configuredPricePerKg,
      enteredPricePerKg: pricePerKg,
      variancePerKg: pricePerKg - configuredPricePerKg,
      reason: saleData.overrideReason || null,
      approvalStatus: isOverride ? 'APPROVED' : 'NOT_REQUIRED',
      approvedBy: approvedOverride?.approvedBy || null,
      approvedAt: approvedOverride?.approvedAt || null,
    },
    status: summary.status === 'pending_approval' ? 'pending_approval' : 'draft',
    cashierId: saleData.cashierId || null,
    cashierName: saleData.cashierName || summary.cashierName || null,
    receiptNumber: saleData.receiptNumber || buildReceiptNumber(branchKey, summary.date, uuidv4()),
  });

  summary.sales.totalRevenue = safeNum(summary.sales?.totalRevenue, 0) + totalRevenue;
  summary.sales.totalKgSold = safeNum(summary.sales?.totalKgSold, 0) + kgSold;
  summary.sales.cashAmount = safeNum(summary.sales?.cashAmount, 0) + split.cashAmount;
  summary.sales.transferAmount = safeNum(summary.sales?.transferAmount, 0) + split.transferAmount;
  summary.sales.posAmount = safeNum(summary.sales?.posAmount, 0) + split.posAmount;
  summary.sales.items.push(sale._id);

  const meterA = safeNum(summary.closingMeters?.meterA, 0) - safeNum(summary.openingMeters?.meterA, 0);
  const meterB = safeNum(summary.closingMeters?.meterB, 0) - safeNum(summary.openingMeters?.meterB, 0);
  summary.reconciliation.calculatedRevenue = (meterA + meterB) * safeNum(summary.pricePerKg, 0);
  summary.reconciliation.discrepancy = safeNum(summary.sales.totalRevenue, 0) - safeNum(summary.reconciliation.calculatedRevenue, 0);
  await summary.save();
  if (approvedOverride) await priceOverrideService.markUsed(approvedOverride.overrideId, { saleId: sale._id, userId: saleData.cashierId || 'system' });
  await auditClose({ summary, action: 'SALE_LOGGED', statusAfter: summary.status, performedBy: saleData.cashierId || 'system', meta: { saleId: String(sale._id), amount: totalRevenue, paymentMethod, productSku: sale.productSku, priceOverride: sale.priceOverride } });
  return normalizeSaleForApi(sale);
};

const createExpenseEntry = async (expenseData) => {
  const summary = await findSummaryByAnyId(expenseData.dailySummaryId);
  if (!summary) throw new HttpError(404, 'Daily summary not found.');
  assertSummaryEditable(summary, 'add expense entries to');

  const amount = safeNum(expenseData.amount, 0);
  if (amount <= 0) throw new HttpError(400, 'Amount must be greater than zero.');

  const expense = await ExpenseTransaction.create({
    dailySummaryId: summary._id,
    branchId: String(expenseData.branchId || summary.branchId),
    cashierId: String(expenseData.cashierId || summary.createdBy || 'system'),
    cashierName: expenseData.cashierName || summary.cashierName || null,
    category: normalizeExpenseCategory(expenseData.category),
    paymentDisposition: normalizePaymentDisposition(expenseData.paymentDisposition || expenseData.paymentMethod),
    description: String(expenseData.description || 'Expense').trim(),
    amount,
    date: expenseData.date || summary.date || new Date(),
    status: summary.status === 'pending_approval' ? 'pending_approval' : 'draft',
  });

  summary.expenses.total = safeNum(summary.expenses?.total, 0) + amount;
  summary.expenses.items.push(expense._id);
  await summary.save();
  await auditClose({ summary, action: 'EXPENSE_LOGGED', statusAfter: summary.status, performedBy: expenseData.cashierId || 'system', meta: { expenseId: String(expense._id), amount, category: expense.category, paymentDisposition: expense.paymentDisposition } });
  return normalizeExpenseForApi(expense);
};

const getDailyEntries = async (summaryId) => {
  const summary = await findSummaryByAnyIdLean(summaryId, true);
  if (!summary) throw new HttpError(404, 'Daily summary not found.');
  const sales = (summary.sales?.items || []).map(normalizeSaleForApi);
  const expenses = (summary.expenses?.items || []).map(normalizeExpenseForApi);
  const entries = [...sales, ...expenses].sort((a, b) => new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date));
  return { summary, sales, expenses, entries };
};

const validateFinalizationControls = (summary, controls = {}) => {
  const salesTotal = safeNum(summary?.sales?.totalRevenue, 0);
  const expensesTotal = safeNum(summary?.expenses?.total, 0);
  const meterA = safeNum(summary?.closingMeters?.meterA, 0) - safeNum(summary?.openingMeters?.meterA, 0);
  const meterB = safeNum(summary?.closingMeters?.meterB, 0) - safeNum(summary?.openingMeters?.meterB, 0);
  const totalMeteredKg = meterA + meterB;
  const variance = safeNum(summary?.reconciliation?.discrepancy, 0);
  const varianceTolerance = safeNum(controls.varianceTolerance, 100);
  const errors = [];
  if (salesTotal <= 0 && expensesTotal <= 0) errors.push('No sales or expenses have been captured for this daily summary.');
  if (salesTotal > 0 && !controls.meterReadingsConfirmed) errors.push('Meter readings must be confirmed before finalization.');
  if (salesTotal > 0 && totalMeteredKg <= 0) errors.push('Closing meter readings must produce a positive metered quantity for a sales day.');
  if (!controls.salesReviewed) errors.push('Sales lines/totals must be reviewed before finalization.');
  if (!controls.expensesReviewed) errors.push('Expense lines must be reviewed before finalization.');
  if (!controls.reconciliationReviewed) errors.push('Reconciliation must be reviewed before finalization.');
  if (Math.abs(variance) > varianceTolerance && !controls.varianceAcknowledged) errors.push('Reconciliation variance exceeds tolerance and must be acknowledged with a reason.');
  return { ok: errors.length === 0, errors, totalMeteredKg, variance, varianceTolerance };
};

const finalizeDailySummary = async (summaryId, controls = {}, finalizedBy = 'system') => {
  const summary = await findSummaryByAnyId(summaryId);
  if (!summary) throw new HttpError(404, 'Daily summary not found.');

  if (summary.status === 'pending_approval') return summary;
  if (summary.status === 'approved') throw new HttpError(400, 'Summary is already approved. You can post it to GL.');
  if (summary.status === 'rejected') throw new HttpError(400, 'Summary is rejected. Reopen it through the correction workflow before resubmitting.');
  if (isPosted(summary)) throw new HttpError(400, 'Posted summaries cannot be finalized again. Use reversal/correction workflow.');
  if (summary.status !== 'in_progress') {
    throw new HttpError(400, 'Summary cannot be finalized from status: ' + (summary.status || 'unknown') + '.');
  }

  const validation = validateFinalizationControls(summary, controls || {});
  if (!validation.ok) {
    throw new HttpError(400, 'Finalization checklist failed: ' + validation.errors.join(' | '));
  }

  const before = summary.status;
  summary.status = 'pending_approval';
  summary.finalizationControls = {
    meterReadingsConfirmed: Boolean(controls.meterReadingsConfirmed),
    salesReviewed: Boolean(controls.salesReviewed),
    expensesReviewed: Boolean(controls.expensesReviewed),
    reconciliationReviewed: Boolean(controls.reconciliationReviewed),
    varianceAcknowledged: Boolean(controls.varianceAcknowledged),
    varianceReason: controls.varianceReason || null,
    finalizedBy,
    finalizedAt: new Date(),
  };
  await summary.save();
  await SaleTransaction.updateMany({ dailySummaryId: summary._id }, { $set: { status: 'pending_approval' } });
  await ExpenseTransaction.updateMany({ dailySummaryId: summary._id }, { $set: { status: 'pending_approval' } });
  await auditClose({ summary, action: 'FINALIZE', statusBefore: before, statusAfter: summary.status, performedBy: finalizedBy, meta: validation });
  return summary;
};

const getDailySummaryReport = async (summaryId) => {
  let q = mongoose.Types.ObjectId.isValid(String(summaryId)) ? DailySummary.findById(summaryId) : DailySummary.findOne({ dailySummaryId: String(summaryId) });
  const summary = await q.populate('branchId', 'name').populate('sales.items').populate('expenses.items').lean();
  if (!summary) throw new HttpError(404, 'Daily summary not found.');
  return summary;
};

const getPendingSummaries = async () => DailySummary.find({ status: 'pending_approval' }).populate('branchId', 'name').sort({ date: -1 }).lean();

const getOpenDailySummaries = async (filters = {}) => {
  const { startDate, endDate, branchId, limit = 100 } = filters;
  const query = { status: { $in: ["in_progress", "pending_approval", "rejected"] } };
  if (startDate) query.date = { $gte: startOfDay(startDate) };
  if (endDate) {
    if (!query.date) query.date = {};
    query.date.$lte = endOfDay(endDate);
  }
  if (branchId) Object.assign(query, buildBranchHistoryMatch(branchId));
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  return DailySummary.find(query).populate("branchId", "name").sort({ date: 1, updatedAt: -1 }).limit(safeLimit).lean();
};

const updateDailySummaryStatus = async (summaryId, newStatus, rejectionReason = null, approverId = null, options = {}) => {
  if (!['approved', 'rejected'].includes(newStatus)) throw new HttpError(400, 'Invalid target status.');
  const summary = await findSummaryByAnyId(summaryId);
  if (!summary) throw new HttpError(404, 'Daily summary not found.');
  if (summary.status !== 'pending_approval') throw new HttpError(400, 'Only pending summaries can be approved or rejected.');

  if (newStatus === 'approved') {
    const maker = String(summary.finalizationControls?.finalizedBy || summary.createdBy || '').trim();
    const checker = String(approverId || '').trim();
    if (maker && checker && maker === checker && options.enforceMakerChecker !== false) {
      throw new HttpError(400, 'Maker-checker control failed: the user who finalized/created this daily close cannot approve it. Assign another approver or provide a controlled override.');
    }
  }

  const now = new Date();
  summary.status = newStatus;
  summary.managerApproval = {
    isApproved: newStatus === 'approved',
    approvedBy: newStatus === 'approved' ? approverId : null,
    approvedAt: newStatus === 'approved' ? now : null,
    rejectedBy: newStatus === 'rejected' ? approverId : null,
    rejectedAt: newStatus === 'rejected' ? now : null,
    rejectionReason: newStatus === 'rejected' ? rejectionReason : null,
  };
  await summary.save();
  await auditClose({ summary, action: newStatus === 'approved' ? 'APPROVE' : 'REJECT', statusBefore: 'pending_approval', statusAfter: newStatus, performedBy: approverId || 'system', reason: rejectionReason || options.comment || null, meta: { comment: options.comment || null, policyOverrideReason: options.policyOverrideReason || null } });

  const childPatch = newStatus === 'approved'
    ? { status: 'approved', approvedBy: approverId, approvedAt: now, rejectedBy: null, rejectedAt: null, rejectionReason: null }
    : { status: 'rejected', rejectedBy: approverId, rejectedAt: now, rejectionReason, approvedBy: null, approvedAt: null };
  await SaleTransaction.updateMany({ dailySummaryId: summary._id }, { $set: { status: newStatus } });
  await ExpenseTransaction.updateMany({ dailySummaryId: summary._id }, { $set: childPatch });
  return summary;
};

const getDailySummaryHistory = async (filters = {}) => {
  const { startDate, endDate, branchId, status, limit = 100 } = filters;
  const query = {};
  if (startDate) query.date = { $gte: startOfDay(startDate) };
  if (endDate) {
    if (!query.date) query.date = {};
    query.date.$lte = endOfDay(endDate);
  }
  if (branchId) Object.assign(query, buildBranchHistoryMatch(branchId));
  if (status && status !== 'all') {
    if (Array.isArray(status)) query.status = { $in: status };
    else query.status = String(status).toLowerCase();
  }
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  return DailySummary.find(query).populate('branchId', 'name').sort({ date: -1, updatedAt: -1 }).limit(safeLimit).lean();
};

const getTransactionHistory = async (filters = {}) => {
  const { startDate, endDate, branchId, includeSummaries = true } = filters;
  const query = {};
  if (startDate) query.date = { $gte: startOfDay(startDate) };
  if (endDate) {
    if (!query.date) query.date = {};
    query.date.$lte = endOfDay(endDate);
  }
  if (branchId) Object.assign(query, buildBranchHistoryMatch(branchId));

  const [salesRaw, expensesRaw, summariesRaw] = await Promise.all([
    SaleTransaction.find(query).lean(),
    ExpenseTransaction.find(query).lean(),
    String(includeSummaries).toLowerCase() === 'false' ? [] : DailySummary.find(query).lean(),
  ]);

  const summaryMap = new Map((summariesRaw || []).map((d) => [String(d._id), d]));

  const sales = (salesRaw || []).map((sale) => {
    const shaped = normalizeSaleForApi(sale);
    const parent = sale.dailySummaryId ? summaryMap.get(String(sale.dailySummaryId)) : null;

    // Sale lines are covered by the DailySummary aggregated GL journal.
    if (parent?.posting?.status === 'POSTED') {
      shaped.posting = {
        ...(shaped.posting || {}),
        status: 'POSTED',
        glEntryId: parent.posting.glEntryId || (Array.isArray(parent.posting.glEntryIds) ? parent.posting.glEntryIds[0] : null),
        glEntryIds: parent.posting.glEntryIds || [],
        postedVia: 'DAILY_SUMMARY',
        dailySummaryId: String(parent._id),
      };
    }
    return { ...shaped, type: 'Sale', sourceType: 'SALE_TX' };
  });

  const expenses = (expensesRaw || []).map((e) => ({ ...normalizeExpenseForApi(e), type: 'Expense', sourceType: 'EXPENSE' }));
  const summaries = (summariesRaw || []).map((d) => normalizeSummaryForApi(d));

  return [...summaries, ...sales, ...expenses].sort((a, b) => new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt));
};

const reopenDailySummary = async (summaryId, { reason, reopenedBy = 'system' } = {}) => {
  if (!reason || !String(reason).trim()) throw new HttpError(400, 'Reopen reason is required.');
  const summary = await findSummaryByAnyId(summaryId);
  if (!summary) throw new HttpError(404, 'Daily summary not found.');
  if (isPosted(summary)) throw new HttpError(400, 'Posted summaries cannot be reopened directly. Reverse the GL journal first.');
  const current = String(summary.status || '').toLowerCase();
  if (!['rejected', 'approved', 'pending_approval'].includes(current)) throw new HttpError(400, 'Only rejected, approved-unposted or pending summaries can be reopened.');
  const before = summary.status;
  summary.status = 'in_progress';
  summary.managerApproval = { isApproved: false, approvedBy: null, approvedAt: null, rejectedBy: null, rejectedAt: null, rejectionReason: null };
  summary.finalizationControls = { meterReadingsConfirmed: false, salesReviewed: false, expensesReviewed: false, reconciliationReviewed: false, varianceAcknowledged: false, varianceReason: null, finalizedBy: null, finalizedAt: null };
  summary.correction = { ...(summary.correction || {}), reopenedAt: new Date(), reopenedBy, reopenReason: reason, reopenCount: safeNum(summary.correction?.reopenCount, 0) + 1 };
  await summary.save();
  await SaleTransaction.updateMany({ dailySummaryId: summary._id }, { $set: { status: 'draft' } });
  await ExpenseTransaction.updateMany({ dailySummaryId: summary._id }, { $set: { status: 'draft', approvedBy: null, approvedAt: null, rejectedBy: null, rejectedAt: null, rejectionReason: null } });
  await auditClose({ summary, action: 'REOPEN', statusBefore: before, statusAfter: 'in_progress', performedBy: reopenedBy, reason });
  return summary;
};

const getReceiptHistory = async (summaryId) => {
  const summary = await findSummaryByAnyId(summaryId);
  if (!summary) throw new HttpError(404, 'Daily summary not found.');
  const rows = await SaleTransaction.find({ dailySummaryId: summary._id }).sort({ createdAt: -1 }).lean();
  return rows.map(normalizeSaleForApi);
};



const recalcSummaryTotals = async (summary) => {
  const [sales, expenses] = await Promise.all([
    SaleTransaction.find({ dailySummaryId: summary._id, 'voiding.isVoided': { $ne: true } }).lean(),
    ExpenseTransaction.find({ dailySummaryId: summary._id, 'voiding.isVoided': { $ne: true } }).lean(),
  ]);
  const split = { cashAmount: 0, transferAmount: 0, posAmount: 0, totalRevenue: 0, totalKgSold: 0 };
  sales.forEach((s) => {
    split.totalRevenue += safeNum(s.totalRevenue, 0);
    split.totalKgSold += safeNum(s.kgSold, 0);
    split.cashAmount += safeNum(s.cashAmount, 0);
    split.transferAmount += safeNum(s.transferAmount, 0);
    split.posAmount += safeNum(s.posAmount, 0);
  });
  const expenseTotal = expenses.reduce((sum, e) => sum + safeNum(e.amount, 0), 0);
  summary.sales = { ...(summary.sales || {}), ...split, items: sales.map((x) => x._id) };
  summary.expenses = { ...(summary.expenses || {}), total: expenseTotal, items: expenses.map((x) => x._id) };
  const meterA = safeNum(summary.closingMeters?.meterA, 0) - safeNum(summary.openingMeters?.meterA, 0);
  const meterB = safeNum(summary.closingMeters?.meterB, 0) - safeNum(summary.openingMeters?.meterB, 0);
  summary.reconciliation.calculatedRevenue = (meterA + meterB) * safeNum(summary.pricePerKg, 0);
  summary.reconciliation.discrepancy = safeNum(summary.sales.totalRevenue, 0) - safeNum(summary.reconciliation.calculatedRevenue, 0);
  await summary.save();
  return summary;
};

const voidSaleEntry = async (summaryId, saleId, { reason, voidedBy = 'system' } = {}) => {
  if (!reason || !String(reason).trim()) throw new HttpError(400, 'Void reason is required.');
  const summary = await findSummaryByAnyId(summaryId);
  if (!summary) throw new HttpError(404, 'Daily summary not found.');
  if (isPosted(summary)) throw new HttpError(400, 'Cannot void a sale after the parent daily summary has been posted. Use GL reversal/correction workflow.');
  if (String(summary.status || '').toLowerCase() !== 'in_progress') throw new HttpError(400, 'Reopen the daily summary before voiding sale lines.');
  const sale = await SaleTransaction.findOne({ _id: saleId, dailySummaryId: summary._id });
  if (!sale) throw new HttpError(404, 'Sale entry not found for this daily summary.');
  if (sale.voiding?.isVoided) return normalizeSaleForApi(sale);
  sale.voiding = { isVoided: true, voidedAt: new Date(), voidedBy, voidReason: reason, originalStatus: sale.status, correctionRef: `VOID-SALE-${sale._id}` };
  sale.status = 'voided';
  sale.posting = { ...(sale.posting || {}), status: 'SKIPPED', errorMessage: 'Voided before posting' };
  await sale.save();
  await recalcSummaryTotals(summary);
  await auditClose({ summary, action: 'SALE_VOIDED', statusAfter: summary.status, performedBy: voidedBy, reason, meta: { saleId: String(sale._id), amount: sale.totalRevenue } });
  return normalizeSaleForApi(sale);
};

const voidExpenseEntry = async (summaryId, expenseId, { reason, voidedBy = 'system' } = {}) => {
  if (!reason || !String(reason).trim()) throw new HttpError(400, 'Void reason is required.');
  const summary = await findSummaryByAnyId(summaryId);
  if (!summary) throw new HttpError(404, 'Daily summary not found.');
  if (isPosted(summary)) throw new HttpError(400, 'Cannot void an expense after the parent daily summary has been posted. Use GL reversal/correction workflow.');
  if (String(summary.status || '').toLowerCase() !== 'in_progress') throw new HttpError(400, 'Reopen the daily summary before voiding expense lines.');
  const expense = await ExpenseTransaction.findOne({ _id: expenseId, dailySummaryId: summary._id });
  if (!expense) throw new HttpError(404, 'Expense entry not found for this daily summary.');
  if (expense.voiding?.isVoided) return normalizeExpenseForApi(expense);
  expense.voiding = { isVoided: true, voidedAt: new Date(), voidedBy, voidReason: reason, originalStatus: expense.status, correctionRef: `VOID-EXP-${expense._id}` };
  expense.status = 'voided';
  expense.posting = { ...(expense.posting || {}), status: 'SKIPPED', errorMessage: 'Voided before posting' };
  await expense.save();
  await recalcSummaryTotals(summary);
  await auditClose({ summary, action: 'EXPENSE_VOIDED', statusAfter: summary.status, performedBy: voidedBy, reason, meta: { expenseId: String(expense._id), amount: expense.amount } });
  return normalizeExpenseForApi(expense);
};

const getDailyCloseDashboard = async (filters = {}) => {
  const { startDate, endDate, branchId, limit = 20 } = filters;
  const dateQuery = {};
  if (startDate) dateQuery.$gte = startOfDay(startDate);
  if (endDate) dateQuery.$lte = endOfDay(endDate);
  const base = {};
  if (Object.keys(dateQuery).length) base.date = dateQuery;
  if (branchId) Object.assign(base, buildBranchHistoryMatch(branchId));
  const unresolvedStatuses = ['in_progress', 'pending_approval', 'rejected'];
  const [byStatus, branchRows, staleItems, approvedUnposted, failedPosted] = await Promise.all([
    DailySummary.aggregate([{ $match: base }, { $group: { _id: '$status', count: { $sum: 1 }, sales: { $sum: '$sales.totalRevenue' }, expenses: { $sum: '$expenses.total' } } }]),
    DailySummary.aggregate([{ $match: base }, { $group: { _id: '$branchId', count: { $sum: 1 }, unresolved: { $sum: { $cond: [{ $in: ['$status', unresolvedStatuses] }, 1, 0] } }, approvedUnposted: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'approved'] }, { $ne: ['$posting.status', 'POSTED'] }] }, 1, 0] } }, sales: { $sum: '$sales.totalRevenue' } } }, { $sort: { unresolved: -1, count: -1 } }]),
    DailySummary.find({ ...base, status: { $in: unresolvedStatuses } }).populate('branchId', 'name').sort({ date: 1 }).limit(Number(limit) || 20).lean(),
    DailySummary.countDocuments({ ...base, status: 'approved', 'posting.status': { $ne: 'POSTED' } }),
    DailySummary.countDocuments({ ...base, 'posting.status': 'FAILED' }),
  ]);
  const statusMap = Object.fromEntries(byStatus.map((r) => [r._id || 'unknown', { count: r.count, sales: safeNum(r.sales, 0), expenses: safeNum(r.expenses, 0) }]));
  return {
    ok: true,
    filters: { startDate: startDate || null, endDate: endDate || null, branchId: branchId || null },
    summary: {
      openDays: statusMap.in_progress?.count || 0,
      pendingApproval: statusMap.pending_approval?.count || 0,
      approved: statusMap.approved?.count || 0,
      rejected: statusMap.rejected?.count || 0,
      approvedUnposted,
      failedPostings: failedPosted,
      totalSales: Object.values(statusMap).reduce((s, x) => s + safeNum(x.sales, 0), 0),
      totalExpenses: Object.values(statusMap).reduce((s, x) => s + safeNum(x.expenses, 0), 0),
    },
    byStatus: statusMap,
    byBranch: branchRows,
    staleItems,
    alerts: [
      ...(statusMap.in_progress?.count ? [`${statusMap.in_progress.count} open daily close item(s) not finalized.`] : []),
      ...(statusMap.pending_approval?.count ? [`${statusMap.pending_approval.count} daily close item(s) pending approval.`] : []),
      ...(approvedUnposted ? [`${approvedUnposted} approved daily close item(s) not posted to GL.`] : []),
      ...(failedPosted ? [`${failedPosted} daily close item(s) have failed GL posting.`] : []),
    ],
  };
};

const getDailyCloseAuditTrail = async (summaryId) => {
  const summary = await findSummaryByAnyId(summaryId);
  if (!summary) throw new HttpError(404, 'Daily summary not found.');
  const rows = await DailyCloseAudit.find({ dailySummaryId: summary._id }).sort({ createdAt: -1 }).lean();
  return {
    ok: true,
    summaryId: String(summary._id),
    dailySummaryId: summary.dailySummaryId || null,
    count: rows.length,
    items: rows,
  };
};

const deriveDailyCloseControls = (summary) => {
  const status = String(summary?.status || '').toLowerCase();
  const postingStatus = String(summary?.posting?.status || 'UNPOSTED').toUpperCase();
  const finalized = summary?.finalizationControls || {};
  const salesTotal = safeNum(summary?.sales?.totalRevenue, 0);
  const expenseTotal = safeNum(summary?.expenses?.total, 0);
  const meterA = safeNum(summary?.closingMeters?.meterA, 0) - safeNum(summary?.openingMeters?.meterA, 0);
  const meterB = safeNum(summary?.closingMeters?.meterB, 0) - safeNum(summary?.openingMeters?.meterB, 0);
  const meteredKg = meterA + meterB;
  const variance = safeNum(summary?.reconciliation?.discrepancy, 0);
  const varianceTolerance = 100;
  const varianceNeedsAcknowledgement = Math.abs(variance) > varianceTolerance;

  const checklist = [
    {
      key: 'sales_or_expenses_present',
      label: 'Sales or expenses captured',
      passed: salesTotal > 0 || expenseTotal > 0,
      message: salesTotal > 0 || expenseTotal > 0 ? 'Daily activity exists.' : 'No sales or expenses have been captured for this day.',
    },
    {
      key: 'meter_readings_confirmed',
      label: 'Meter readings confirmed',
      passed: Boolean(finalized.meterReadingsConfirmed) || salesTotal === 0,
      message: salesTotal === 0 ? 'Not required where no sales were recorded.' : 'Cashier must confirm opening and closing meter readings.',
    },
    {
      key: 'positive_metered_quantity',
      label: 'Positive metered quantity',
      passed: salesTotal === 0 || meteredKg > 0,
      message: salesTotal === 0 ? 'Not required where no sales were recorded.' : `${meteredKg} kg metered across active meters.`,
    },
    {
      key: 'sales_reviewed',
      label: 'Sales reviewed',
      passed: Boolean(finalized.salesReviewed),
      message: 'Sales lines, payment methods, price overrides and totals must be reviewed.',
    },
    {
      key: 'expenses_reviewed',
      label: 'Expenses reviewed',
      passed: Boolean(finalized.expensesReviewed),
      message: 'Expense category, description, payment disposition and amount must be reviewed.',
    },
    {
      key: 'reconciliation_reviewed',
      label: 'Reconciliation reviewed',
      passed: Boolean(finalized.reconciliationReviewed),
      message: 'Sales totals, metered revenue and variance should be reviewed.',
    },
    {
      key: 'variance_acknowledged',
      label: 'Variance acknowledged when outside tolerance',
      passed: !varianceNeedsAcknowledgement || Boolean(finalized.varianceAcknowledged),
      message: varianceNeedsAcknowledgement ? `Variance ${variance} exceeds tolerance ${varianceTolerance}; acknowledge and provide reason.` : 'Variance is within tolerance.',
    },
  ];

  const failed = checklist.filter((x) => !x.passed);
  const allowedActions = {
    canFinalize: status === 'in_progress' && postingStatus !== 'POSTED',
    canApprove: status === 'pending_approval',
    canReject: status === 'pending_approval',
    canReopen: ['rejected', 'approved', 'pending_approval'].includes(status) && postingStatus !== 'POSTED',
    canVoidLines: status === 'in_progress' && postingStatus !== 'POSTED',
    canPostGL: status === 'approved' && postingStatus !== 'POSTED',
    canReverseGL: postingStatus === 'POSTED',
  };

  return {
    lifecycle: {
      status: status || 'unknown',
      postingStatus,
      closeState: postingStatus === 'POSTED' ? 'POSTED' : status === 'approved' ? 'APPROVED_UNPOSTED' : status === 'pending_approval' ? 'PENDING_APPROVAL' : status === 'rejected' ? 'REJECTED_FOR_CORRECTION' : 'OPEN',
    },
    checklist,
    checklistSummary: {
      total: checklist.length,
      passed: checklist.length - failed.length,
      failed: failed.length,
      readyToFinalize: failed.length === 0,
    },
    allowedActions,
    metrics: { salesTotal, expenseTotal, meteredKg, variance, varianceTolerance, varianceNeedsAcknowledgement },
  };
};

const getDailyCloseControlPack = async (summaryId) => {
  const summary = await findSummaryByAnyIdLean(summaryId, true);
  if (!summary) throw new HttpError(404, 'Daily summary not found.');
  const [audit, receipts] = await Promise.all([
    DailyCloseAudit.find({ dailySummaryId: summary._id }).sort({ createdAt: -1 }).lean(),
    SaleTransaction.find({ dailySummaryId: summary._id }).sort({ createdAt: -1 }).lean(),
  ]);
  const sales = (summary.sales?.items || []).map(normalizeSaleForApi);
  const expenses = (summary.expenses?.items || []).map(normalizeExpenseForApi);
  return {
    ok: true,
    summary,
    controls: deriveDailyCloseControls(summary),
    entries: { sales, expenses, count: sales.length + expenses.length },
    receipts: receipts.map(normalizeSaleForApi),
    audit: { count: audit.length, items: audit },
  };
};

const getDailyCloseActionList = async (filters = {}) => {
  const { startDate, endDate, branchId, limit = 100 } = filters;
  const dateQuery = {};
  if (startDate) dateQuery.$gte = startOfDay(startDate);
  if (endDate) dateQuery.$lte = endOfDay(endDate);
  const base = {};
  if (Object.keys(dateQuery).length) base.date = dateQuery;
  if (branchId) Object.assign(base, buildBranchHistoryMatch(branchId));
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const rows = await DailySummary.find({
    ...base,
    $or: [
      { status: { $in: ['in_progress', 'pending_approval', 'rejected'] } },
      { status: 'approved', 'posting.status': { $ne: 'POSTED' } },
      { 'posting.status': 'FAILED' },
    ],
  }).populate('branchId', 'name').sort({ date: 1, updatedAt: -1 }).limit(safeLimit).lean();

  const actionItems = rows.map((summary) => {
    const controls = deriveDailyCloseControls(summary);
    const status = String(summary.status || '').toLowerCase();
    const postingStatus = String(summary?.posting?.status || 'UNPOSTED').toUpperCase();
    let issue = 'Open daily close item';
    let recommendedAction = 'Review and complete daily close checklist';
    let severity = 'MEDIUM';
    if (status === 'pending_approval') { issue = 'Pending approval'; recommendedAction = 'Approve or reject after review'; severity = 'HIGH'; }
    if (status === 'rejected') { issue = 'Rejected closeout awaiting correction'; recommendedAction = 'Reopen, correct, and resubmit'; severity = 'HIGH'; }
    if (status === 'approved' && postingStatus !== 'POSTED') { issue = 'Approved but not posted'; recommendedAction = 'Post approved day to GL'; severity = 'HIGH'; }
    if (postingStatus === 'FAILED') { issue = 'Failed GL posting'; recommendedAction = 'Review posting exception and retry'; severity = 'CRITICAL'; }
    return {
      summaryId: String(summary._id),
      dailySummaryId: summary.dailySummaryId || null,
      businessDate: summary.date,
      branch: summary.branchId?.name || summary.branchName || String(summary.branchId || ''),
      issue,
      severity,
      recommendedAction,
      status,
      postingStatus,
      amount: safeNum(summary?.sales?.totalRevenue, 0),
      controls: controls.checklistSummary,
    };
  });

  return {
    ok: true,
    filters: { startDate: startDate || null, endDate: endDate || null, branchId: branchId || null },
    count: actionItems.length,
    items: actionItems,
    summary: {
      critical: actionItems.filter((x) => x.severity === 'CRITICAL').length,
      high: actionItems.filter((x) => x.severity === 'HIGH').length,
      medium: actionItems.filter((x) => x.severity === 'MEDIUM').length,
    },
  };
};

const bulkAddDailySummaries = async (summaries) => DailySummary.insertMany(summaries.map((s) => ({ ...s, dailySummaryId: s.dailySummaryId || s.summaryId || uuidv4(), status: s.status || 'approved' })), { ordered: true });
const bulkAddExpenseTransactions = async (expenses) => ExpenseTransaction.insertMany(expenses.map((e) => ({ ...e, category: normalizeExpenseCategory(e.category), paymentDisposition: normalizePaymentDisposition(e.paymentDisposition), status: e.status || 'approved' })), { ordered: true });

module.exports = { createOrGetDailySummary, updateSummaryMeters, createSaleEntry, createExpenseEntry, getDailyEntries, finalizeDailySummary, getDailySummaryReport, getPendingSummaries, getOpenDailySummaries, getDailySummaryHistory, updateDailySummaryStatus, reopenDailySummary, getReceiptHistory, getDailyCloseAuditTrail, getDailyCloseControlPack, getDailyCloseActionList, getTransactionHistory, voidSaleEntry, voidExpenseEntry, getDailyCloseDashboard, bulkAddDailySummaries, bulkAddExpenseTransactions };
