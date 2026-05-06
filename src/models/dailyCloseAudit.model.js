const mongoose = require('mongoose');

const dailyCloseAuditSchema = new mongoose.Schema(
  {
    dailySummaryId: { type: mongoose.Schema.Types.ObjectId, ref: 'DailySummary', index: true, default: null },
    dailySummaryPublicId: { type: String, default: null, index: true },
    branchId: { type: String, default: null, index: true },
    businessDate: { type: Date, default: null, index: true },
    action: {
      type: String,
      enum: ['CREATE', 'UPDATE_METERS', 'SALE_LOGGED', 'EXPENSE_LOGGED', 'FINALIZE', 'APPROVE', 'REJECT', 'REOPEN', 'POST_TO_GL', 'RETRY_FAILED', 'REVERSE_GL', 'SALE_VOIDED', 'EXPENSE_VOIDED', 'CORRECTION_RESUBMITTED', 'OPENING_BALANCE_DRAFTED', 'OPENING_BALANCE_SUBMITTED', 'OPENING_BALANCE_POSTED', 'PRICE_OVERRIDE_REQUESTED', 'PRICE_OVERRIDE_APPROVED', 'PRICE_OVERRIDE_REJECTED', 'POS_REVERSAL_REQUESTED', 'POS_REVERSAL_COMPLETED', 'PLANT_STATUS_UPDATED', 'MAINTENANCE_LOGGED'],
      required: true,
      index: true,
    },
    statusBefore: { type: String, default: null },
    statusAfter: { type: String, default: null },
    performedBy: { type: String, default: 'system', index: true },
    reason: { type: String, default: null },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

dailyCloseAuditSchema.index({ dailySummaryId: 1, createdAt: -1 });
dailyCloseAuditSchema.index({ branchId: 1, businessDate: 1, createdAt: -1 });

module.exports = mongoose.model('DailyCloseAudit', dailyCloseAuditSchema);
