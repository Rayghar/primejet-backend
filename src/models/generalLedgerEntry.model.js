// File: src/models/generalLedgerEntry.model.js
const mongoose = require('mongoose');

const safeNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const derivePeriodKey = (date) => {
  const d = date ? new Date(date) : new Date();
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 7);
  return d.toISOString().slice(0, 7);
};

const glLineSchema = new mongoose.Schema(
  {
    accountCode: { type: String, required: true, trim: true, index: true },
    debit: { type: Number, default: 0, min: 0 },
    credit: { type: Number, default: 0, min: 0 },
    narration: { type: String, default: '', trim: true },
  },
  { _id: false }
);

const generalLedgerEntrySchema = new mongoose.Schema(
  {
    date: { type: Date, required: true, index: true },
    periodKey: { type: String, required: true, index: true },
    branchKey: { type: String, default: null, index: true },

    sourceType: {
      type: String,
      required: true,
      enum: ['DAILY_SUMMARY', 'SALE_TX', 'EXPENSE', 'STOCK_IN', 'OPENING_STOCK', 'STOCK_MOVEMENT', 'ORDER', 'MANUAL', 'REVERSAL'],
      index: true,
    },
    sourceId: { type: String, default: null, index: true },
    entryType: { type: String, default: 'PRIMARY', index: true },
    version: { type: Number, default: 1, min: 1 },

    narration: { type: String, default: '', trim: true },
    status: {
      type: String,
      enum: ['POSTED', 'REVERSED', 'VOID'],
      default: 'POSTED',
      index: true,
    },

    lines: { type: [glLineSchema], default: [] },
    totals: {
      debit: { type: Number, default: 0 },
      credit: { type: Number, default: 0 },
      diff: { type: Number, default: 0 },
    },

    meta: { type: mongoose.Schema.Types.Mixed, default: {} },

    reversedAt: { type: Date, default: null },
    reversedBy: { type: String, default: null },
    reversalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'GeneralLedgerEntry', default: null },
    reversedByEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'GeneralLedgerEntry', default: null },
    reversesEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'GeneralLedgerEntry', default: null },
  },
  { timestamps: true, strict: true }
);

generalLedgerEntrySchema.pre('validate', function setDerivedFields(next) {
  if (!this.periodKey && this.date) this.periodKey = derivePeriodKey(this.date);
  if (!this.version) this.version = 1;

  const debit = (this.lines || []).reduce((s, l) => s + safeNum(l.debit, 0), 0);
  const credit = (this.lines || []).reduce((s, l) => s + safeNum(l.credit, 0), 0);
  this.totals = {
    debit,
    credit,
    diff: Math.abs(debit - credit),
  };
  next();
});

generalLedgerEntrySchema.index({ branchKey: 1, date: -1, status: 1 });
generalLedgerEntrySchema.index({ date: -1, status: 1, sourceType: 1 });
generalLedgerEntrySchema.index({ periodKey: 1, branchKey: 1, status: 1 });

// Idempotency: one journal per source/version.
generalLedgerEntrySchema.index(
  { branchKey: 1, sourceType: 1, sourceId: 1, entryType: 1, version: 1 },
  { unique: true, partialFilterExpression: { sourceId: { $type: 'string' } } }
);

generalLedgerEntrySchema.statics.derivePeriodKey = derivePeriodKey;

module.exports = mongoose.model('GeneralLedgerEntry', generalLedgerEntrySchema);
