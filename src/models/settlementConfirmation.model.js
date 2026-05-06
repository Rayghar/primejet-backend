// src/models/settlementConfirmation.model.js
const mongoose = require('mongoose');

const SETTLEMENT_STATUSES = [
  'NOT_REVIEWED',
  'PARTIALLY_CONFIRMED',
  'FULLY_CONFIRMED',
  'VARIANCE_DETECTED',
  'ESCALATED',
  'RESOLVED',
];

const safeNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const methodConfirmationSchema = new mongoose.Schema(
  {
    expectedAmount: { type: Number, default: 0 },
    actualAmount: { type: Number, default: null },
    variance: { type: Number, default: 0 },
    status: { type: String, enum: SETTLEMENT_STATUSES, default: 'NOT_REVIEWED', index: true },
    reference: { type: String, default: null, trim: true },
    narration: { type: String, default: null, trim: true },
    terminalOrChannel: { type: String, default: null, trim: true },
    varianceReason: { type: String, default: null, trim: true },
    notes: { type: String, default: null, trim: true },
    confirmedBy: { type: String, default: null, trim: true },
    confirmedAt: { type: Date, default: null },
  },
  { _id: false }
);

const settlementConfirmationSchema = new mongoose.Schema(
  {
    dailySummaryId: { type: mongoose.Schema.Types.ObjectId, ref: 'DailySummary', required: true, index: true, unique: true },
    dailySummaryBusinessId: { type: String, default: null, index: true },
    businessDate: { type: Date, required: true, index: true },
    branchId: { type: String, required: true, index: true },
    cashierName: { type: String, default: null, trim: true },

    expected: {
      cashSales: { type: Number, default: 0 },
      cashExpenses: { type: Number, default: 0 },
      expectedCashOnHand: { type: Number, default: 0 },
      transferSales: { type: Number, default: 0 },
      posSales: { type: Number, default: 0 },
      totalExpectedSettlement: { type: Number, default: 0 },
    },

    cash: { type: methodConfirmationSchema, default: () => ({}) },
    transfer: { type: methodConfirmationSchema, default: () => ({}) },
    pos: { type: methodConfirmationSchema, default: () => ({}) },

    settlementStatus: {
      type: String,
      enum: SETTLEMENT_STATUSES,
      default: 'NOT_REVIEWED',
      index: true,
    },

    isOptionalControl: { type: Boolean, default: true, index: true },
    escalation: {
      escalatedAt: { type: Date, default: null },
      escalatedBy: { type: String, default: null },
      escalationNote: { type: String, default: null },
      resolvedAt: { type: Date, default: null },
      resolvedBy: { type: String, default: null },
      resolutionNote: { type: String, default: null },
    },

    lastReviewedBy: { type: String, default: null },
    lastReviewedAt: { type: Date, default: null },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

settlementConfirmationSchema.index({ branchId: 1, businessDate: 1 });
settlementConfirmationSchema.index({ settlementStatus: 1, businessDate: -1 });

settlementConfirmationSchema.pre('validate', function deriveStatus(next) {
  const methods = ['cash', 'transfer', 'pos'];
  let reviewed = 0;
  let varianceDetected = false;
  let escalated = false;
  let resolved = false;

  for (const method of methods) {
    const row = this[method] || {};
    const expectedAmount = safeNum(row.expectedAmount, 0);
    const actualAmount = row.actualAmount === null || row.actualAmount === undefined ? null : safeNum(row.actualAmount, 0);
    if (actualAmount !== null) {
      row.variance = expectedAmount - actualAmount;
      reviewed += 1;
    } else {
      row.variance = 0;
    }

    if (row.status === 'ESCALATED') escalated = true;
    if (row.status === 'RESOLVED') resolved = true;
    if (row.status === 'VARIANCE_DETECTED' || Math.abs(safeNum(row.variance, 0)) > 0.01) varianceDetected = true;
  }

  if (escalated) this.settlementStatus = 'ESCALATED';
  else if (resolved) this.settlementStatus = 'RESOLVED';
  else if (reviewed === 0) this.settlementStatus = 'NOT_REVIEWED';
  else if (varianceDetected) this.settlementStatus = 'VARIANCE_DETECTED';
  else if (reviewed < methods.length) this.settlementStatus = 'PARTIALLY_CONFIRMED';
  else this.settlementStatus = 'FULLY_CONFIRMED';

  next();
});

module.exports = mongoose.model('SettlementConfirmation', settlementConfirmationSchema);
module.exports.SETTLEMENT_STATUSES = SETTLEMENT_STATUSES;
