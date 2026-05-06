// File: src/api/v2/gl/handlers/postReversal.js
//
// GL Posting Handler: Reversal (Reverse an existing posted GL entry)
//
// Why you need this:
// - In GL-first, you NEVER “edit” a posted journal in-place.
// - You reverse it (equal and opposite), then post a fresh corrected entry.
//
// Behavior:
// - Finds the original GL entry by _id (or by sourceType+sourceId+branchKey+entryType if you pass those).
// - Validates it is POSTED (not already reversed).
// - Creates a new GL entry with entryType = 'REVERSAL' (or `${entryType}_REVERSAL`),
//   with reversed debit/credit lines.
// - Marks original entry status = 'REVERSED' and links it to reversal entry.
// - Optionally updates the source document posting metadata back to UNPOSTED/FAILED (best-effort).
//
// NOTE:
// - Your GeneralLedgerEntry schema must have fields:
//   date, branchKey, sourceType, sourceId, entryType, status, narration, lines[]
//   and ideally: reversedAt, reversedBy, reversalEntryId (or similar)
// - If your schema differs, adjust field names here accordingly.

const mongoose = require('mongoose');

const GeneralLedgerEntry = require('../../../../models/generalLedgerEntry.model');

// Optional: if you want to update source docs (best-effort), you can wire these models.
// We keep them optional to avoid crashing if not present.
let Order = null;
let DailySummary = null;
let ExpenseTransaction = null;
let StockIn = null;

try {
  // eslint-disable-next-line global-require
  Order = require('../../../../models/order.model');
  // eslint-disable-next-line global-require
  DailySummary = require('../../../../models/dailySummary.model');
  // eslint-disable-next-line global-require
  ExpenseTransaction = require('../../../../models/expenseTransaction.model');
  // eslint-disable-next-line global-require
  StockIn = require('../../../../models/stockIn.model');
} catch (e) {
  // ignore
}

// Optional policy
let policy = null;
try {
  // eslint-disable-next-line global-require
  policy = require('../policyMatrix');
} catch (e) {
  policy = null;
}

// -------------------------
// helpers
// -------------------------
const safeNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const toISODate = (d) => {
  const x = d ? new Date(d) : null;
  return x && !Number.isNaN(x.getTime()) ? x : null;
};

const endOfDay = (d) => {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
};

const sumLines = (lines) => {
  const debit = (lines || []).reduce((s, l) => s + safeNum(l.debit, 0), 0);
  const credit = (lines || []).reduce((s, l) => s + safeNum(l.credit, 0), 0);
  return { debit, credit };
};

const assertBalanced = (lines, tolerance = 0.5) => {
  const { debit, credit } = sumLines(lines);
  const diff = Math.abs(debit - credit);
  if (diff > tolerance) {
    const e = new Error(`Unbalanced journal: debit=${debit}, credit=${credit}, diff=${diff}`);
    e.code = 'UNBALANCED_JOURNAL';
    e.meta = { debit, credit, diff };
    throw e;
  }
};

const getTolerances = () => {
  const t = policy?.tolerances && typeof policy.tolerances === 'object' ? policy.tolerances : {};
  return {
    journalBalance: safeNum(t.journalBalance, 0.5),
  };
};

const reverseLines = (lines) =>
  (lines || []).map((l) => ({
    accountCode: String(l.accountCode),
    debit: safeNum(l.credit, 0),
    credit: safeNum(l.debit, 0),
    narration: l.narration ? `REVERSAL: ${String(l.narration).slice(0, 160)}` : 'REVERSAL',
  }));

const findSourceModel = (sourceType) => {
  const st = String(sourceType || '').toUpperCase();
  if (st === 'ORDER') return Order;
  if (st === 'DAILY_SUMMARY') return DailySummary;
  if (st === 'EXPENSE') return ExpenseTransaction;
  if (st === 'STOCK_IN') return StockIn;
  return null;
};

// Best-effort: mark source doc as UNPOSTED so it can be reposted
const bestEffortUpdateSourcePosting = async ({ sourceType, sourceId, branchKey, reversalEntryId, reversedBy }) => {
  const M = findSourceModel(sourceType);
  if (!M) return;

  const filter = { _id: sourceId };
  // DailySummary might use dailySummaryId as sourceId in some flows
  if (String(sourceType).toUpperCase() === 'DAILY_SUMMARY') {
    filter.$or = [{ _id: sourceId }, { dailySummaryId: sourceId }];
  }

  // We do not enforce branch matching at DB level because source docs may store branchId as ObjectId.
  // Rebuild/posting uses tolerant matching anyway.

  try {
    await M.updateOne(filter, {
      $set: {
        posting: {
          status: 'UNPOSTED',
          reversedAt: new Date(),
          reversedBy: reversedBy || null,
          reversalEntryId,
        },
      },
    });
  } catch (e) {
    // ignore if schema doesn't include posting subdoc
  }
};

/**
 * postReversal
 *
 * Accepts either:
 *  A) { glEntryId }
 *  B) { branchKey, sourceType, sourceId, entryType }  (to locate original)
 *
 * Options:
 *  - reversalDate: ISO date string (default: original.date)
 *  - reversedBy: string (admin id/email)
 *  - reason: string
 *  - unpostSource: boolean (default: true) -> sets source posting.status back to UNPOSTED (best-effort)
 */
async function postReversal(input = {}, opts = {}) {
  const tol = getTolerances();

  const {
    glEntryId,
    branchKey: qBranchKey,
    sourceType: qSourceType,
    sourceId: qSourceId,
    entryType: qEntryType,
  } = input || {};

  let original = null;

  if (glEntryId) {
    original = await GeneralLedgerEntry.findById(glEntryId).lean();
  } else {
    if (!qSourceType || !qSourceId) {
      const e = new Error('Provide glEntryId OR (sourceType + sourceId).');
      e.code = 'BAD_REQUEST';
      throw e;
    }

    const filter = {
      sourceType: String(qSourceType),
      sourceId: String(qSourceId),
      status: { $in: ['POSTED', 'REVERSED'] },
    };

    if (qBranchKey != null && String(qBranchKey).trim() !== '') filter.branchKey = String(qBranchKey);
    if (qEntryType != null && String(qEntryType).trim() !== '') filter.entryType = String(qEntryType);

    original = await GeneralLedgerEntry.findOne(filter).sort({ createdAt: -1 }).lean();
  }

  if (!original) {
    const e = new Error('Original GL entry not found.');
    e.code = 'NOT_FOUND';
    throw e;
  }

  if (String(original.status || '').toUpperCase() === 'REVERSED') {
    const e = new Error('GL entry already reversed.');
    e.code = 'ALREADY_REVERSED';
    throw e;
  }

  // Reverse date defaults to original business date (or allow override)
  const reversalDate = toISODate(opts.reversalDate) || toISODate(original.date) || new Date();
  // ensure end-of-day safety if user provides date-only
  const reversalDateFinal = endOfDay(reversalDate);

  const reversedBy = opts.reversedBy || null;
  const reason = opts.reason || '';

  const reversedLines = reverseLines(original.lines || []);
  assertBalanced(reversedLines, tol.journalBalance);

  // Derive reversal entryType
  const origEntryType = String(original.entryType || 'PRIMARY');
  const reversalEntryType =
    origEntryType.toUpperCase().includes('REVERSAL') ? origEntryType : `${origEntryType}_REVERSAL`;

  const revDoc = {
    date: reversalDateFinal,
    branchKey: original.branchKey || (qBranchKey != null ? String(qBranchKey) : null),
    sourceType: original.sourceType,
    sourceId: original.sourceId,
    entryType: reversalEntryType,
    status: 'POSTED',
    narration: `REVERSAL of ${String(original._id)}${reason ? ` — ${String(reason).slice(0, 140)}` : ''}`,
    lines: reversedLines,
    totals: sumLines(reversedLines),
    meta: {
      reversalOf: String(original._id),
      reversedBy,
      reversedAt: new Date(),
      reason,
    },
  };

  // Idempotency: only one reversal per original entry id + entryType
  // If your schema has a unique index, this will behave correctly; otherwise we enforce by query.
  const existing = await GeneralLedgerEntry.findOne({
    'meta.reversalOf': String(original._id),
    entryType: reversalEntryType,
    branchKey: revDoc.branchKey || null,
  })
    .select('_id')
    .lean();

  let reversalEntryId = existing?._id || null;

  if (!reversalEntryId) {
    const created = await GeneralLedgerEntry.create(revDoc);
    reversalEntryId = created?._id || null;
  }

  // Mark original as reversed and link it
  await GeneralLedgerEntry.updateOne(
    { _id: original._id },
    {
      $set: {
        status: 'REVERSED',
        reversedAt: new Date(),
        reversedBy,
        reversalEntryId,
      },
    }
  );

  // Best-effort: mark source doc UNPOSTED again so it can be corrected & reposted
  const unpostSource = opts.unpostSource !== undefined ? Boolean(opts.unpostSource) : true;
  if (unpostSource) {
    await bestEffortUpdateSourcePosting({
      sourceType: original.sourceType,
      sourceId: original.sourceId,
      branchKey: original.branchKey,
      reversalEntryId,
      reversedBy,
    });
  }

  return {
    ok: true,
    originalEntryId: String(original._id),
    reversalEntryId: reversalEntryId ? String(reversalEntryId) : null,
    sourceType: original.sourceType,
    sourceId: original.sourceId,
    branchKey: original.branchKey || null,
    entryType: origEntryType,
    reversalEntryType,
    reversalDate: reversalDateFinal,
  };
}

module.exports = postReversal;
module.exports.postReversal = postReversal;