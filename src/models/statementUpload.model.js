// src/models/statementUpload.model.js
const mongoose = require('mongoose');

const SOURCE_TYPES = ['BANK', 'POS', 'PAYSTACK', 'MONNIFY', 'OTHER'];
const ROW_STATUSES = ['UNMATCHED', 'MATCHED', 'DUPLICATE_REFERENCE', 'UNDER_SETTLED', 'OVER_SETTLED', 'IGNORED'];

const statementRowSchema = new mongoose.Schema(
  {
    transactionDate: { type: Date, default: null, index: true },
    reference: { type: String, default: null, trim: true, index: true },
    narration: { type: String, default: null, trim: true },
    amount: { type: Number, default: 0 },
    debit: { type: Number, default: 0 },
    credit: { type: Number, default: 0 },
    channel: { type: String, default: null, trim: true },
    branchId: { type: String, default: null, trim: true, index: true },
    status: { type: String, enum: ROW_STATUSES, default: 'UNMATCHED', index: true },
    matchedSettlementId: { type: mongoose.Schema.Types.ObjectId, ref: 'SettlementConfirmation', default: null },
    matchNote: { type: String, default: null, trim: true },
    raw: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: true }
);

const statementUploadSchema = new mongoose.Schema(
  {
    sourceType: { type: String, enum: SOURCE_TYPES, required: true, default: 'BANK', index: true },
    uploadName: { type: String, default: null, trim: true },
    branchId: { type: String, default: null, trim: true, index: true },
    periodStart: { type: Date, default: null, index: true },
    periodEnd: { type: Date, default: null, index: true },
    uploadedBy: { type: String, default: null, trim: true },
    uploadedAt: { type: Date, default: Date.now, index: true },
    status: { type: String, enum: ['UPLOADED', 'PARSED', 'MATCHED', 'REVIEW_REQUIRED'], default: 'UPLOADED', index: true },
    rows: { type: [statementRowSchema], default: [] },
    summary: {
      rowCount: { type: Number, default: 0 },
      totalDebit: { type: Number, default: 0 },
      totalCredit: { type: Number, default: 0 },
      totalAmount: { type: Number, default: 0 },
      duplicateReferenceCount: { type: Number, default: 0 },
      unmatchedCount: { type: Number, default: 0 },
      matchedCount: { type: Number, default: 0 },
    },
    rawTextSample: { type: String, default: null },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

statementUploadSchema.index({ sourceType: 1, uploadedAt: -1 });
statementUploadSchema.index({ branchId: 1, uploadedAt: -1 });

module.exports = mongoose.model('StatementUpload', statementUploadSchema);
module.exports.SOURCE_TYPES = SOURCE_TYPES;
module.exports.ROW_STATUSES = ROW_STATUSES;
