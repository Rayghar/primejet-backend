// src/models/dailySummary.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const PostingSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ['UNPOSTED', 'QUEUED', 'POSTED', 'FAILED', 'SKIPPED', 'REVERSED'],
      default: 'UNPOSTED',
      index: true,
    },
    glEntryId: { type: String, default: null },
    glEntryIds: { type: [String], default: [] },
    postedAt: { type: Date, default: null },
    postedBy: { type: String, default: null },
    attempts: { type: Number, default: 0 },
    errorCode: { type: String, default: null },
    errorMessage: { type: String, default: null },
    // keep for future use but do NOT use it in GL idempotency
    version: { type: Number, default: 1 },
  },
  { _id: false }
);

const dailySummarySchema = new mongoose.Schema(
  {
    dailySummaryId: {
      type: String,
      unique: true,
      required: true,
      default: uuidv4,
      index: true,
    },

    // ✅ Business date used for POS accounting
    date: { type: Date, required: true, index: true },

    // Normalized YYYY-MM-DD business date key for duplicate prevention
    businessDateKey: { type: String, default: null, index: true },

    // Plant/Branch
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Plant',
      required: true,
      index: true,
    },

    cashierName: { type: String, required: true, minlength: 3, maxlength: 100 },

    // ✅ pricePerKg is used in controller/service
    pricePerKg: { type: Number, required: true, min: 0.01, default: 0.01 },

    status: {
      type: String,
      enum: ['in_progress', 'pending_approval', 'approved', 'rejected', 'posted', 'closed'],
      default: 'in_progress',
      index: true,
    },

    openingMeters: {
      meterA: { type: Number, required: true, default: 0 },
      meterB: { type: Number, default: 0 },
    },
    closingMeters: {
      meterA: { type: Number, required: true, default: 0 },
      meterB: { type: Number, default: 0 },
    },

    // ✅ Must match data-entry.service expectations
    sales: {
      totalRevenue: { type: Number, default: 0 },     // used by GL + financials
      totalKgSold: { type: Number, default: 0 },
      posAmount: { type: Number, default: 0 },
      cashAmount: { type: Number, default: 0 },
      transferAmount: { type: Number, default: 0 },

      // Keep (if you ever store sale tx IDs)
      items: [{ type: mongoose.Schema.Types.ObjectId, ref: 'SaleTransaction' }],

      // Backward compatibility if any legacy code wrote this
      calculatedRevenue: { type: Number, default: 0 },
    },

    expenses: {
      total: { type: Number, default: 0 },
      items: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ExpenseTransaction' }],
    },

    reconciliation: {
      calculatedRevenue: { type: Number, default: 0 },
      discrepancy: { type: Number, default: 0 },
    },

    managerApproval: {
      approvedBy: { type: String, default: null },
      approvedAt: { type: Date, default: null },
      rejectedBy: { type: String, default: null },
      rejectedAt: { type: Date, default: null },
      isApproved: { type: Boolean, default: false },
      rejectionReason: { type: String, default: null },
      approvalComment: { type: String, default: null },
      rejectionComment: { type: String, default: null },
      policyOverrideReason: { type: String, default: null },
    },

    // ✅ Required for GL posting pipeline to persist state
    posting: { type: PostingSchema, default: () => ({}) },

    // Optional Wave 11A advisory settlement control.
    // This must never block POS, close approval or GL posting.
    settlement: {
      status: {
        type: String,
        enum: [
          'NOT_REVIEWED',
          'PARTIALLY_CONFIRMED',
          'FULLY_CONFIRMED',
          'VARIANCE_DETECTED',
          'ESCALATED',
          'RESOLVED',
        ],
        default: 'NOT_REVIEWED',
        index: true,
      },
      confirmationId: { type: mongoose.Schema.Types.ObjectId, ref: 'SettlementConfirmation', default: null },
      lastReviewedAt: { type: Date, default: null },
      lastReviewedBy: { type: String, default: null },
      isOptionalControl: { type: Boolean, default: true },
    },

    createdBy: { type: String, default: null },

    finalizationControls: {
      meterReadingsConfirmed: { type: Boolean, default: false },
      salesReviewed: { type: Boolean, default: false },
      expensesReviewed: { type: Boolean, default: false },
      reconciliationReviewed: { type: Boolean, default: false },
      varianceAcknowledged: { type: Boolean, default: false },
      varianceReason: { type: String, default: null },
      finalizedBy: { type: String, default: null },
      finalizedAt: { type: Date, default: null },
    },

    correction: {
      reopenedAt: { type: Date, default: null },
      reopenedBy: { type: String, default: null },
      reopenReason: { type: String, default: null },
      reopenCount: { type: Number, default: 0 },
      lastCorrectionReason: { type: String, default: null },
    },
  },
  { timestamps: true }
);

dailySummarySchema.pre('validate', function setBusinessDateKey(next) {
  if (this.date) {
    const d = new Date(this.date);
    if (!Number.isNaN(d.getTime())) this.businessDateKey = d.toISOString().slice(0, 10);
  }
  next();
});

dailySummarySchema.index({ dailySummaryId: 1 }, { unique: true });
dailySummarySchema.index(
  { branchId: 1, businessDateKey: 1 },
  { unique: true, partialFilterExpression: { businessDateKey: { $type: 'string' } } }
);
dailySummarySchema.index({ branchId: 1, date: -1, status: 1 });
dailySummarySchema.index({ date: -1, status: 1, 'posting.status': 1 });

module.exports = mongoose.model('DailySummary', dailySummarySchema);
