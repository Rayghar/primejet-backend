const dataEntryService = require('./data-entry.service');
const HttpError = require('../../../utils/HttpError');
const mongoose = require('mongoose');
const { resolveBranchIdentity } = require('../utils/branchIdentity');

const hasVal = (v) => v !== undefined && v !== null && String(v).trim() !== '';
const toNumber = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const getUserId = (req) => req.user?.id || req.user?._id || 'system';
const getUserName = (req) => req.user?.name || req.user?.fullName || req.user?.email || 'System User';

const requireObjectId = (value, label) => {
  if (!mongoose.Types.ObjectId.isValid(String(value))) throw new HttpError(400, `Invalid ${label}: ${value}`);
};

const resolveBranchObjectId = async (value) => {
  const identity = await resolveBranchIdentity(value);
  if (!identity.objectIds.length) throw new HttpError(400, `Invalid branchId: ${value}`);
  return String(identity.objectIds[0]);
};

const createOrGetSummary = async (req, res, next) => {
  try {
    const { branchId, date } = req.body;
    const cashierName = req.body.cashierName || getUserName(req);
    const pricePerKg = toNumber(req.body.pricePerKg ?? 0.01);
    if (!hasVal(branchId)) throw new HttpError(400, 'branchId is required');
    const resolvedBranchId = await resolveBranchObjectId(branchId);
    const summary = await dataEntryService.createOrGetDailySummary({ branchId: resolvedBranchId, cashierName, pricePerKg, userId: getUserId(req), date });
    res.status(200).json(summary);
  } catch (error) {
    next(error);
  }
};

const updateMeters = async (req, res, next) => {
  try {
    const { summaryId } = req.params;
    if (!hasVal(summaryId)) throw new HttpError(400, 'summaryId is required');
    const { openingMeters, closingMeters, pricePerKg } = req.body;
    if (!openingMeters || !closingMeters) throw new HttpError(400, 'openingMeters and closingMeters are required');
    const updatedSummary = await dataEntryService.updateSummaryMeters(summaryId, { openingMeters, closingMeters, pricePerKg: toNumber(pricePerKg) });
    res.status(200).json(updatedSummary);
  } catch (error) {
    next(error);
  }
};

const createSaleEntry = async (req, res, next) => {
  try {
    const dailySummaryId = req.params.summaryId || req.body.dailySummaryId;
    const branchId = req.body.branchId;
    if (!hasVal(dailySummaryId)) throw new HttpError(400, 'dailySummaryId is required');
    const resolvedBranchId = branchId ? await resolveBranchObjectId(branchId) : undefined;

    const saleData = {
      ...req.body,
      dailySummaryId,
      branchId: resolvedBranchId,
      branchAlias: branchId || null,
      kgSold: toNumber(req.body.kgSold ?? req.body.quantity),
      pricePerKg: toNumber(req.body.pricePerKg ?? req.body.unitPrice),
      totalRevenue: toNumber(req.body.totalRevenue ?? req.body.amount ?? req.body.revenue),
      paymentMethod: req.body.paymentMethod || req.body.transactionType,
      cashierId: getUserId(req),
      cashierName: req.body.cashierName || getUserName(req),
    };
    const newSale = await dataEntryService.createSaleEntry(saleData);
    res.status(201).json({ ...newSale, transaction: newSale, sale: newSale });
  } catch (error) {
    next(error);
  }
};

const createExpenseEntry = async (req, res, next) => {
  try {
    const dailySummaryId = req.params.summaryId || req.body.dailySummaryId;
    const branchId = req.body.branchId;
    if (!hasVal(dailySummaryId)) throw new HttpError(400, 'dailySummaryId is required');
    const resolvedBranchId = branchId ? await resolveBranchObjectId(branchId) : undefined;
    if (!hasVal(req.body.description)) throw new HttpError(400, 'description is required');
    if (toNumber(req.body.amount) === null || toNumber(req.body.amount) <= 0) throw new HttpError(400, 'amount must be greater than zero');

    const expense = await dataEntryService.createExpenseEntry({
      ...req.body,
      dailySummaryId,
      branchId: resolvedBranchId,
      branchAlias: branchId || null,
      amount: toNumber(req.body.amount),
      cashierId: getUserId(req),
      cashierName: req.body.cashierName || getUserName(req),
    });
    res.status(201).json({ ...expense, transaction: expense, expense });
  } catch (error) {
    next(error);
  }
};

const getDailyEntries = async (req, res, next) => {
  try {
    const summaryId = req.params.summaryId || req.query.summaryId;
    if (!hasVal(summaryId)) throw new HttpError(400, 'summaryId is required');
    const entries = await dataEntryService.getDailyEntries(summaryId);
    res.status(200).json(entries);
  } catch (error) {
    next(error);
  }
};

const finalizeSummary = async (req, res, next) => {
  try {
    const { summaryId } = req.params;
    if (!hasVal(summaryId)) throw new HttpError(400, 'summaryId is required');
    const finalizedSummary = await dataEntryService.finalizeDailySummary(summaryId, req.body || {}, getUserId(req));
    res.status(200).json(finalizedSummary);
  } catch (error) {
    next(error);
  }
};

const getSummaryReport = async (req, res, next) => {
  try {
    const { summaryId } = req.params;
    if (!hasVal(summaryId)) throw new HttpError(400, 'summaryId is required');
    const report = await dataEntryService.getDailySummaryReport(summaryId);
    res.status(200).json(report);
  } catch (error) {
    next(error);
  }
};

const getPendingSummariesForApproval = async (req, res, next) => {
  try {
    const summaries = await dataEntryService.getPendingSummaries();
    res.status(200).json(summaries);
  } catch (error) {
    next(error);
  }
};

const getOpenDailySummaries = async (req, res, next) => {
  try {
    const summaries = await dataEntryService.getOpenDailySummaries(req.query || {});
    res.status(200).json({ count: summaries.length, items: summaries });
  } catch (error) {
    next(error);
  }
};

const getDailySummaryHistory = async (req, res, next) => {
  try {
    const summaries = await dataEntryService.getDailySummaryHistory(req.query || {});
    res.status(200).json(summaries);
  } catch (error) {
    next(error);
  }
};

const approveDailySummary = async (req, res, next) => {
  try {
    const { summaryId } = req.params;
    if (!hasVal(summaryId)) throw new HttpError(400, 'summaryId is required');
    const updatedSummary = await dataEntryService.updateDailySummaryStatus(summaryId, 'approved', null, getUserId(req), {
      comment: req.body?.comment || req.body?.approvalComment || null,
      enforceMakerChecker: req.body?.enforceMakerChecker !== false,
      policyOverrideReason: req.body?.policyOverrideReason || null,
    });
    res.status(200).json(updatedSummary);
  } catch (error) {
    next(error);
  }
};

const rejectDailySummary = async (req, res, next) => {
  try {
    const { summaryId } = req.params;
    const { reason } = req.body;
    if (!hasVal(summaryId)) throw new HttpError(400, 'summaryId is required');
    if (!hasVal(reason)) throw new HttpError(400, 'Rejection reason is required');
    const updatedSummary = await dataEntryService.updateDailySummaryStatus(summaryId, 'rejected', reason, getUserId(req), { comment: req.body?.comment || null });
    res.status(200).json(updatedSummary);
  } catch (error) {
    next(error);
  }
};

const reopenDailySummary = async (req, res, next) => {
  try {
    const { summaryId } = req.params;
    const { reason } = req.body || {};
    if (!hasVal(summaryId)) throw new HttpError(400, 'summaryId is required');
    if (!hasVal(reason)) throw new HttpError(400, 'Reopen reason is required');
    const updatedSummary = await dataEntryService.reopenDailySummary(summaryId, { reason, reopenedBy: getUserId(req) });
    res.status(200).json(updatedSummary);
  } catch (error) {
    next(error);
  }
};

const getReceiptHistory = async (req, res, next) => {
  try {
    const summaryId = req.params.summaryId || req.query.summaryId;
    if (!hasVal(summaryId)) throw new HttpError(400, 'summaryId is required');
    const receipts = await dataEntryService.getReceiptHistory(summaryId);
    res.status(200).json({ count: receipts.length, items: receipts });
  } catch (error) {
    next(error);
  }
};



const voidSaleEntry = async (req, res, next) => {
  try {
    const { summaryId, saleId } = req.params;
    const { reason } = req.body || {};
    if (!hasVal(summaryId)) throw new HttpError(400, 'summaryId is required');
    if (!hasVal(saleId)) throw new HttpError(400, 'saleId is required');
    if (!hasVal(reason)) throw new HttpError(400, 'Void reason is required');
    const sale = await dataEntryService.voidSaleEntry(summaryId, saleId, { reason, voidedBy: getUserId(req) });
    res.status(200).json({ ok: true, sale });
  } catch (error) { next(error); }
};

const voidExpenseEntry = async (req, res, next) => {
  try {
    const { summaryId, expenseId } = req.params;
    const { reason } = req.body || {};
    if (!hasVal(summaryId)) throw new HttpError(400, 'summaryId is required');
    if (!hasVal(expenseId)) throw new HttpError(400, 'expenseId is required');
    if (!hasVal(reason)) throw new HttpError(400, 'Void reason is required');
    const expense = await dataEntryService.voidExpenseEntry(summaryId, expenseId, { reason, voidedBy: getUserId(req) });
    res.status(200).json({ ok: true, expense });
  } catch (error) { next(error); }
};

const getDailyCloseDashboard = async (req, res, next) => {
  try {
    const dashboard = await dataEntryService.getDailyCloseDashboard(req.query || {});
    res.status(200).json(dashboard);
  } catch (error) { next(error); }
};

const getDailyCloseAuditTrail = async (req, res, next) => {
  try {
    const { summaryId } = req.params;
    if (!hasVal(summaryId)) throw new HttpError(400, 'summaryId is required');
    const result = await dataEntryService.getDailyCloseAuditTrail(summaryId);
    res.status(200).json(result);
  } catch (error) { next(error); }
};

const getDailyCloseControlPack = async (req, res, next) => {
  try {
    const { summaryId } = req.params;
    if (!hasVal(summaryId)) throw new HttpError(400, 'summaryId is required');
    const result = await dataEntryService.getDailyCloseControlPack(summaryId);
    res.status(200).json(result);
  } catch (error) { next(error); }
};

const getDailyCloseActionList = async (req, res, next) => {
  try {
    const result = await dataEntryService.getDailyCloseActionList(req.query || {});
    res.status(200).json(result);
  } catch (error) { next(error); }
};

const getTransactionHistory = async (req, res, next) => {
  try {
    const history = await dataEntryService.getTransactionHistory(req.query);
    res.status(200).json(history);
  } catch (error) {
    next(error);
  }
};

const migrateDailySummaries = async (req, res, next) => {
  try {
    const summaries = req.body;
    if (!Array.isArray(summaries) || summaries.length === 0) throw new HttpError(400, 'Summaries must be a non-empty array');
    const result = await dataEntryService.bulkAddDailySummaries(summaries);
    res.status(201).json({ message: 'Daily summaries migrated successfully.', count: result.length });
  } catch (error) {
    next(error);
  }
};

const migrateExpenseTransactions = async (req, res, next) => {
  try {
    const expenses = req.body;
    if (!Array.isArray(expenses) || expenses.length === 0) throw new HttpError(400, 'Expenses must be a non-empty array');
    const result = await dataEntryService.bulkAddExpenseTransactions(expenses);
    res.status(201).json({ message: 'Expense transactions migrated successfully.', count: result.length });
  } catch (error) {
    next(error);
  }
};

module.exports = { createOrGetSummary, updateMeters, createSaleEntry, createExpenseEntry, getDailyEntries, finalizeSummary, getSummaryReport, getPendingSummariesForApproval, getOpenDailySummaries, getDailySummaryHistory, approveDailySummary, rejectDailySummary, reopenDailySummary, voidSaleEntry, voidExpenseEntry, getDailyCloseDashboard, getDailyCloseAuditTrail, getDailyCloseControlPack, getDailyCloseActionList, getReceiptHistory, getTransactionHistory, migrateDailySummaries, migrateExpenseTransactions };
