// src/models/branchPrice.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const branchPriceSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4(), index: true },
    branchId: { type: String, required: true, index: true },
    productId: { type: String, required: true, index: true },
    productSku: { type: String, default: null, index: true },
    pricePerKg: { type: Number, required: true, min: 0 },
    fixedPrice: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: 'NGN' },
    effectiveStartDate: { type: Date, required: true, index: true },
    effectiveEndDate: { type: Date, default: null, index: true },
    status: { type: String, enum: ['DRAFT', 'ACTIVE', 'EXPIRED', 'DISABLED'], default: 'ACTIVE', index: true },
    approvalStatus: { type: String, enum: ['NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED'], default: 'NOT_REQUIRED' },
    createdBy: { type: String, default: null },
    approvedBy: { type: String, default: null },
    approvedAt: { type: Date, default: null },
    notes: { type: String, default: null, trim: true },
  },
  { timestamps: true }
);

branchPriceSchema.index({ branchId: 1, productId: 1, effectiveStartDate: -1 });

module.exports = mongoose.model('BranchPrice', branchPriceSchema);
