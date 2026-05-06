// src/models/priceOverrideRequest.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const priceOverrideRequestSchema = new mongoose.Schema(
  {
    overrideId: { type: String, required: true, unique: true, default: () => uuidv4(), index: true },
    branchId: { type: String, required: true, index: true },
    productId: { type: String, default: null, index: true },
    productSku: { type: String, default: null, index: true },
    businessDate: { type: Date, required: true, index: true },
    configuredPricePerKg: { type: Number, required: true, min: 0 },
    requestedPricePerKg: { type: Number, required: true, min: 0 },
    variancePerKg: { type: Number, default: 0 },
    reason: { type: String, required: true, trim: true },
    status: { type: String, enum: ['REQUESTED', 'APPROVED', 'REJECTED', 'EXPIRED', 'USED'], default: 'REQUESTED', index: true },
    requestedBy: { type: String, default: null, index: true },
    approvedBy: { type: String, default: null },
    approvedAt: { type: Date, default: null },
    rejectedBy: { type: String, default: null },
    rejectedAt: { type: Date, default: null },
    approvalComment: { type: String, default: null },
    rejectionReason: { type: String, default: null },
    validUntil: { type: Date, default: null, index: true },
    usedAt: { type: Date, default: null },
    usedBy: { type: String, default: null },
    saleId: { type: mongoose.Schema.Types.ObjectId, ref: 'SaleTransaction', default: null, index: true },
  },
  { timestamps: true }
);

priceOverrideRequestSchema.index({ branchId: 1, businessDate: 1, status: 1 });

module.exports = mongoose.model('PriceOverrideRequest', priceOverrideRequestSchema);
