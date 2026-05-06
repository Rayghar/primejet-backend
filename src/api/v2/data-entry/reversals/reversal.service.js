// src/api/v2/data-entry/reversals/reversal.service.js
const mongoose = require('mongoose');
const PosReversalRequest = require('../../../../models/posReversalRequest.model');
const SaleTransaction = require('../../../../models/saleTransaction.model');
const ExpenseTransaction = require('../../../../models/expenseTransaction.model');
const DailySummary = require('../../../../models/dailySummary.model');
const StockIn = require('../../../../models/stockIn.model');
const StockMovement = require('../../../../models/stockMovement.model');
const HttpError = require('../../../../utils/HttpError');
const { writeControlAudit } = require('../../control/auditTrail.service');
const { assertOpenPeriod, toNum, hasVal } = require('../../control/operationalValidation.service');

const normalizeIdQuery = (id) => ({ $or: [{ _id: mongoose.Types.ObjectId.isValid(String(id)) ? new mongoose.Types.ObjectId(id) : null }, { reversalId: String(id) }].filter((x) => Object.values(x)[0]) });

const findSummary = async (id) => {
  if (!id) return null;
  if (mongoose.Types.ObjectId.isValid(String(id))) {
    const row = await DailySummary.findById(id);
    if (row) return row;
  }
  return DailySummary.findOne({ dailySummaryId: String(id) });
};

const recalcSummary = async (summary) => {
  if (!summary) return null;
  const [sales, expenses] = await Promise.all([
    SaleTransaction.find({ dailySummaryId: summary._id, 'voiding.isVoided': { $ne: true }, status: { $nin: ['voided', 'reversed'] } }).lean(),
    ExpenseTransaction.find({ dailySummaryId: summary._id, 'voiding.isVoided': { $ne: true }, status: { $nin: ['voided', 'reversed'] } }).lean(),
  ]);
  summary.sales.totalRevenue = sales.reduce((s, x) => s + toNum(x.totalRevenue, 0), 0);
  summary.sales.totalKgSold = sales.reduce((s, x) => s + toNum(x.kgSold, 0), 0);
  summary.sales.cashAmount = sales.reduce((s, x) => s + toNum(x.cashAmount, 0), 0);
  summary.sales.transferAmount = sales.reduce((s, x) => s + toNum(x.transferAmount, 0), 0);
  summary.sales.posAmount = sales.reduce((s, x) => s + toNum(x.posAmount, 0), 0);
  summary.expenses.total = expenses.reduce((s, x) => s + toNum(x.amount, 0), 0);
  const meterA = toNum(summary.closingMeters?.meterA, 0) - toNum(summary.openingMeters?.meterA, 0);
  const meterB = toNum(summary.closingMeters?.meterB, 0) - toNum(summary.openingMeters?.meterB, 0);
  summary.reconciliation.calculatedRevenue = (meterA + meterB) * toNum(summary.pricePerKg, 0);
  summary.reconciliation.discrepancy = toNum(summary.sales.totalRevenue, 0) - toNum(summary.reconciliation.calculatedRevenue, 0);
  await summary.save();
  return summary;
};

const restoreStockForSale = async (sale, userId, reason) => {
  const qty = toNum(sale.kgSold, 0);
  if (qty <= 0) return null;
  const branchId = String(sale.branchId);
  const cost = toNum(sale.priceOverride?.configuredPricePerKg, 0) || toNum(sale.pricePerKg, 0) || 0.01;
  const stock = await StockIn.create({
    id: new mongoose.Types.ObjectId().toString(),
    branchId,
    stockType: 'RECONCILIATION_GAIN',
    quantityKg: qty,
    remainingKg: qty,
    supplier: 'Sale reversal stock restoration',
    purchaseDate: sale.date || new Date(),
    costPerKg: cost,
    targetSalePricePerKg: toNum(sale.pricePerKg, cost),
    paymentStatus: 'REVERSAL',
    loggedBy: { uid: userId || 'system', email: 'system@local' },
  });
  const movement = await StockMovement.create({
    branchId,
    movementDate: sale.date || new Date(),
    movementType: 'ADJUSTMENT_IN',
    direction: 'IN',
    quantityKg: qty,
    unitCost: cost,
    totalCost: qty * cost,
    sourceType: 'SALE_REVERSAL',
    sourceId: String(sale._id),
    sourceRef: sale.receiptNumber || null,
    narration: `Stock restored from sale reversal: ${reason || ''}`,
    createdBy: userId || 'system',
    meta: { stockInId: String(stock._id), saleId: String(sale._id) },
  });
  return movement;
};

const list = async (filters = {}) => {
  const q = {};
  if (filters.status) q.status = String(filters.status).toUpperCase();
  if (filters.branchId) q.branchId = String(filters.branchId);
  return PosReversalRequest.find(q).sort({ createdAt: -1 }).limit(Number(filters.limit) || 200).lean();
};

const requestSaleReversal = async ({ summaryId, saleId, reason }, userId = 'system') => {
  if (!hasVal(reason)) throw new HttpError(400, 'Reversal reason is required.');
  const summary = await findSummary(summaryId);
  if (!summary) throw new HttpError(404, 'Daily summary not found.');
  const sale = await SaleTransaction.findOne({ _id: saleId, dailySummaryId: summary._id });
  if (!sale) throw new HttpError(404, 'Sale not found for this daily summary.');
  await assertOpenPeriod(summary.date, 'reverse a sale');
  const posted = String(summary.posting?.status || '').toUpperCase() === 'POSTED' || String(sale.posting?.status || '').toUpperCase() === 'POSTED';
  const req = await PosReversalRequest.create({
    sourceType: 'SALE',
    sourceId: sale._id,
    dailySummaryId: summary._id,
    branchId: String(summary.branchId),
    businessDate: summary.date,
    amount: toNum(sale.totalRevenue, 0),
    kgImpact: toNum(sale.kgSold, 0),
    reason,
    status: posted ? 'PENDING_GL_REVERSAL' : 'AUTO_APPROVED',
    requestedBy: userId,
    approvedBy: posted ? null : userId,
    approvedAt: posted ? null : new Date(),
    resultMessage: posted ? 'Sale is already posted. Use GL reversal workflow before correction.' : 'Sale reversal auto-approved because maker-checker enforcement is excluded for this wave.',
  });
  await writeControlAudit({ summary, action: 'POS_REVERSAL_REQUESTED', performedBy: userId, reason, meta: { reversalId: req.reversalId, sourceType: 'SALE', sourceId: String(sale._id), posted } });
  if (!posted) {
    sale.voiding = { isVoided: true, voidedAt: new Date(), voidedBy: userId, voidReason: reason, originalStatus: sale.status, correctionRef: req.reversalId };
    sale.status = 'reversed';
    sale.posting = { ...(sale.posting || {}), status: 'SKIPPED', errorMessage: 'Reversed before posting' };
    await sale.save();
    const movement = await restoreStockForSale(sale, userId, reason).catch(() => null);
    req.status = 'COMPLETED';
    req.completedAt = new Date();
    req.reversalMovementId = movement?.movementId || null;
    req.resultMessage = 'Sale reversed and daily summary totals recalculated.';
    await req.save();
    await recalcSummary(summary);
    await writeControlAudit({ summary, action: 'POS_REVERSAL_COMPLETED', performedBy: userId, reason, meta: { reversalId: req.reversalId, sourceType: 'SALE', movementId: req.reversalMovementId } });
  }
  return req;
};

const requestExpenseReversal = async ({ summaryId, expenseId, reason }, userId = 'system') => {
  if (!hasVal(reason)) throw new HttpError(400, 'Reversal reason is required.');
  const summary = await findSummary(summaryId);
  if (!summary) throw new HttpError(404, 'Daily summary not found.');
  const expense = await ExpenseTransaction.findOne({ _id: expenseId, dailySummaryId: summary._id });
  if (!expense) throw new HttpError(404, 'Expense not found for this daily summary.');
  await assertOpenPeriod(summary.date, 'reverse an expense');
  const posted = String(summary.posting?.status || '').toUpperCase() === 'POSTED' || String(expense.posting?.status || '').toUpperCase() === 'POSTED';
  const req = await PosReversalRequest.create({
    sourceType: 'EXPENSE',
    sourceId: expense._id,
    dailySummaryId: summary._id,
    branchId: String(summary.branchId),
    businessDate: summary.date,
    amount: toNum(expense.amount, 0),
    kgImpact: 0,
    reason,
    status: posted ? 'PENDING_GL_REVERSAL' : 'AUTO_APPROVED',
    requestedBy: userId,
    approvedBy: posted ? null : userId,
    approvedAt: posted ? null : new Date(),
    resultMessage: posted ? 'Expense is already posted. Use GL reversal workflow before correction.' : 'Expense reversal auto-approved because maker-checker enforcement is excluded for this wave.',
  });
  await writeControlAudit({ summary, action: 'POS_REVERSAL_REQUESTED', performedBy: userId, reason, meta: { reversalId: req.reversalId, sourceType: 'EXPENSE', sourceId: String(expense._id), posted } });
  if (!posted) {
    expense.voiding = { isVoided: true, voidedAt: new Date(), voidedBy: userId, voidReason: reason, originalStatus: expense.status, correctionRef: req.reversalId };
    expense.status = 'reversed';
    expense.posting = { ...(expense.posting || {}), status: 'SKIPPED', errorMessage: 'Reversed before posting' };
    await expense.save();
    req.status = 'COMPLETED';
    req.completedAt = new Date();
    req.resultMessage = 'Expense reversed and daily summary totals recalculated.';
    await req.save();
    await recalcSummary(summary);
    await writeControlAudit({ summary, action: 'POS_REVERSAL_COMPLETED', performedBy: userId, reason, meta: { reversalId: req.reversalId, sourceType: 'EXPENSE' } });
  }
  return req;
};

module.exports = { list, requestSaleReversal, requestExpenseReversal };
