// File: src/api/v2/gl/handlers/postExpenseTransaction.js
// Posts approved ExpenseTransaction documents to GL.

const mongoose = require('mongoose');
const ExpenseTransaction = require('../../../../models/expenseTransaction.model');
const { upsertJournal } = require('../services/journalUpsert.service');
const { mapExpenseCategoryToAccount, mapPaymentToCreditAccount, DEFAULT_ACCOUNTS } = require('../services/coaMapping.service');

const safeNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const toISODate = (d) => {
  const x = d ? new Date(d) : null;
  return x && !Number.isNaN(x.getTime()) ? x : null;
};

const toBranchKey = (doc) => {
  const v = doc?.branchId ?? doc?.serviceZoneId ?? doc?.zoneId ?? doc?.plantId ?? doc?.branchKey ?? null;
  return v == null ? null : String(v);
};

const postExpenseTransaction = async (expOrId, opts = {}) => {
  const exp =
    typeof expOrId === 'string' || mongoose.Types.ObjectId.isValid(String(expOrId))
      ? await ExpenseTransaction.findById(expOrId).lean()
      : expOrId;

  if (!exp) return { status: 'SKIPPED', reasonCode: 'EXPENSE_NOT_FOUND', message: 'Expense was not found' };

  const businessDate = toISODate(exp.date);
  if (!businessDate) return { status: 'SKIPPED', reasonCode: 'EXPENSE_INVALID_DATE', message: 'Expense has no valid business date' };

  const branchKey = toBranchKey(exp);
  if (!branchKey) return { status: 'SKIPPED', reasonCode: 'EXPENSE_MISSING_BRANCH', message: 'Expense has no branch/plant key' };

  const status = String(exp.status || '').toLowerCase().trim();
  if (status && status !== 'approved') {
    return { status: 'SKIPPED', reasonCode: 'EXPENSE_NOT_APPROVED', message: `Expense status is ${status}` };
  }

  const amount = safeNum(exp.amount, 0);
  if (amount <= 0) return { status: 'SKIPPED', reasonCode: 'EXPENSE_ZERO_AMOUNT', message: 'Expense amount is zero' };

  const debitAccount = await mapExpenseCategoryToAccount(exp);
  const forceExpensePaymentAccount = String(opts.forceExpensePaymentAccount || process.env.GL_FORCE_EXPENSE_PAYMENT_ACCOUNT || '').trim().toUpperCase();
  const creditAccount = forceExpensePaymentAccount === 'BANK'
    ? DEFAULT_ACCOUNTS.BANK_TRANSFERS
    : await mapPaymentToCreditAccount(exp.paymentDisposition || exp.paymentMethod || exp.mode || 'CASH');
  const description = String(exp.description || exp.narration || 'Expense').trim();

  const lines = [
    { accountCode: debitAccount, debit: amount, credit: 0, narration: description },
    { accountCode: creditAccount, debit: 0, credit: amount, narration: 'Expense settlement' },
  ];

  if (opts.dryRun) {
    return { status: 'POSTED', glEntryIds: [], message: 'Dry run: expense journal is valid' };
  }

  try {
    const sourceId = String(exp._id);
    const result = await upsertJournal({
      date: businessDate,
      branchKey,
      sourceType: 'EXPENSE',
      sourceId,
      entryType: opts.entryType || 'PRIMARY',
      narration: `Expense ${sourceId} - ${description}`.slice(0, 180),
      lines,
      meta: { dailySummaryId: exp.dailySummaryId ? String(exp.dailySummaryId) : null, category: exp.category, paymentDisposition: exp.paymentDisposition, forcedExpensePaymentAccount: forceExpensePaymentAccount || null, postingBatchId: opts.postingBatchId || null },
    });

    return { status: 'POSTED', glEntryIds: result.glEntryIds, message: 'Expense posted to GL' };
  } catch (e) {
    return { status: 'FAILED', reasonCode: e.code || 'EXPENSE_POSTING_FAILED', message: e.message || 'Expense posting failed' };
  }
};

module.exports = postExpenseTransaction;
module.exports.post = postExpenseTransaction;
module.exports.postExpenseTransaction = postExpenseTransaction;
