const mongoose = require('mongoose');

const glReversalRequestSchema = new mongoose.Schema(
  {
    journalId: { type: mongoose.Schema.Types.ObjectId, ref: 'GeneralLedgerEntry', required: true, index: true },
    reason: { type: String, required: true, trim: true },
    requestedBy: { type: String, required: true, index: true },
    requestedAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED', 'EXECUTED'], default: 'PENDING', index: true },
    reviewedBy: { type: String, default: null },
    reviewedAt: { type: Date, default: null },
    reviewComment: { type: String, default: null },
    reversalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'GeneralLedgerEntry', default: null },
    executedAt: { type: Date, default: null },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

glReversalRequestSchema.index({ journalId: 1, status: 1 });
module.exports = mongoose.model('GLReversalRequest', glReversalRequestSchema);
