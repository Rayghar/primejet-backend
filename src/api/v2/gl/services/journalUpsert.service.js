// File: src/api/v2/gl/services/journalUpsert.service.js
// Shared helper for GL handlers to create/update one balanced journal idempotently.

const GeneralLedgerEntry = require('../../../../models/generalLedgerEntry.model');

const safeNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const derivePeriodKey = (date) => {
  const d = date ? new Date(date) : new Date();
  if (Number.isNaN(d.getTime())) {
    const e = new Error('Invalid journal date');
    e.code = 'BAD_DATE';
    throw e;
  }
  return d.toISOString().slice(0, 7);
};

const normalizeLines = (lines) =>
  (Array.isArray(lines) ? lines : [])
    .map((l) => ({
      accountCode: String(l.accountCode || '').trim(),
      debit: safeNum(l.debit, 0),
      credit: safeNum(l.credit, 0),
      narration: l.narration ? String(l.narration) : '',
    }))
    .filter((l) => l.accountCode && (l.debit > 0 || l.credit > 0));

const sumLines = (lines) => {
  const debit = (lines || []).reduce((s, l) => s + safeNum(l.debit, 0), 0);
  const credit = (lines || []).reduce((s, l) => s + safeNum(l.credit, 0), 0);
  return { debit, credit, diff: Math.abs(debit - credit) };
};

const assertBalanced = (lines, tolerance = 0.5) => {
  const totals = sumLines(lines);
  if (totals.diff > tolerance) {
    const e = new Error(`Unbalanced journal: debit=${totals.debit} credit=${totals.credit} diff=${totals.diff}`);
    e.code = 'UNBALANCED_JOURNAL';
    e.meta = totals;
    throw e;
  }
  return totals;
};

const upsertJournal = async ({
  date,
  branchKey = null,
  sourceType,
  sourceId,
  entryType = 'PRIMARY',
  version = 1,
  narration = '',
  lines = [],
  meta = {},
}) => {
  const journalDate = new Date(date);
  if (!date || Number.isNaN(journalDate.getTime())) {
    const e = new Error('Invalid journal date');
    e.code = 'BAD_DATE';
    throw e;
  }
  if (!sourceType || !sourceId) {
    const e = new Error('sourceType and sourceId are required');
    e.code = 'MISSING_SOURCE';
    throw e;
  }

  const normalized = normalizeLines(lines);
  const totals = assertBalanced(normalized);
  const doc = {
    date: journalDate,
    periodKey: derivePeriodKey(journalDate),
    branchKey: branchKey ? String(branchKey) : null,
    sourceType: String(sourceType),
    sourceId: String(sourceId),
    entryType: String(entryType || 'PRIMARY'),
    version: Number(version || 1),
    narration: String(narration || ''),
    status: 'POSTED',
    lines: normalized,
    totals,
    meta: meta || {},
  };

  const filter = {
    branchKey: doc.branchKey,
    sourceType: doc.sourceType,
    sourceId: doc.sourceId,
    entryType: doc.entryType,
    version: doc.version,
  };

  await GeneralLedgerEntry.updateOne(filter, { $set: doc }, { upsert: true });
  const found = await GeneralLedgerEntry.findOne(filter).select('_id').lean();
  return { glEntryIds: found?._id ? [String(found._id)] : [], totals };
};

module.exports = { upsertJournal, assertBalanced, sumLines, derivePeriodKey };
