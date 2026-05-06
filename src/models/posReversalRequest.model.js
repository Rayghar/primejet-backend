// src/models/posReversalRequest.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const posReversalRequestSchema = new mongoose.Schema(
  {
    reversalId: { type: String, required: true, unique: true, default: () => uuidv4(), index: true },
    sourceType: { type: String, enum: ['SALE', 'EXPENSE'], required: true, index: true },
    sourceId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    dailySummaryId: { type: mongoose.Schema.Types.ObjectId, ref: 'DailySummary', default: null, index: true },
    branchId: { type: String, required: true, index: true },
    businessDate: { type: Date, default: null, index: true },
    amount: { type: Number, default: 0 },
    kgImpact: { type: Number, default: 0 },
    reason: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ['REQUESTED', 'AUTO_APPROVED', 'REJECTED', 'COMPLETED', 'PENDING_GL_REVERSAL', 'FAILED'],
      default: 'REQUESTED',
      index: true,
    },
    requestedBy: { type: String, default: null, index: true },
    approvedBy: { type: String, default: null },
    approvedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    resultMessage: { type: String, default: null },
    reversalMovementId: { type: String, default: null },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

posReversalRequestSchema.index({ sourceType: 1, sourceId: 1, status: 1 });

module.exports = mongoose.model('PosReversalRequest', posReversalRequestSchema);
