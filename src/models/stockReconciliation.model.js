// src/models/stockReconciliation.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const postingSchema = new mongoose.Schema(
  {
    status: { type: String, enum: ['UNPOSTED', 'POSTED', 'FAILED', 'SKIPPED'], default: 'UNPOSTED', index: true },
    glEntryId: { type: String, default: null },
    glEntryIds: { type: [String], default: [] },
    postedAt: { type: Date, default: null },
    postedBy: { type: String, default: null },
    attempts: { type: Number, default: 0 },
    errorCode: { type: String, default: null },
    errorMessage: { type: String, default: null },
  },
  { _id: false }
);

const stockReconciliationSchema = new mongoose.Schema(
  {
    reconciliationId: { type: String, unique: true, default: uuidv4, index: true },
    branchId: { type: String, required: true, index: true },
    businessDate: { type: Date, required: true, index: true },
    systemQtyKg: { type: Number, required: true, min: 0 },
    physicalQtyKg: { type: Number, required: true, min: 0 },
    varianceKg: { type: Number, required: true },
    wacCostPerKg: { type: Number, default: 0 },
    varianceValue: { type: Number, default: 0 },
    reason: { type: String, required: true, trim: true },
    status: { type: String, enum: ['RECORDED', 'POSTED', 'REJECTED'], default: 'RECORDED', index: true },
    createdBy: { type: String, default: null },
    approvedBy: { type: String, default: null },
    approvedAt: { type: Date, default: null },
    posting: { type: postingSchema, default: () => ({}) },
  },
  { timestamps: true }
);

stockReconciliationSchema.index({ branchId: 1, businessDate: 1 });

module.exports = mongoose.model('StockReconciliation', stockReconciliationSchema);
