// src/models/stockIn.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const PostingSchema = new mongoose.Schema(
  {
    status: { type: String, enum: ['UNPOSTED', 'QUEUED', 'POSTED', 'FAILED', 'SKIPPED', 'REVERSED'], default: 'UNPOSTED', index: true },
    glEntryId: { type: String, default: null },
    glEntryIds: { type: [String], default: [] },
    postedAt: { type: Date, default: null },
    postedBy: { type: String, default: null },
    attempts: { type: Number, default: 0 },
    errorCode: { type: String, default: null },
    errorMessage: { type: String, default: null },
    version: { type: Number, default: 1 },
  },
  { _id: false }
);

const stockInSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4(), index: true },
    branchId: { type: String, required: true, index: true },
    stockType: { type: String, enum: ['PURCHASE', 'OPENING_STOCK', 'RECONCILIATION_GAIN'], default: 'PURCHASE', index: true },
    quantityKg: { type: Number, required: true, min: 0.01 },
    remainingKg: { type: Number, required: true, min: 0 },
    supplier: { type: String, required: true, trim: true, maxlength: 100 },
    purchaseDate: { type: Date, required: true, index: true },
    costPerKg: { type: Number, required: true, min: 0.01 },
    targetSalePricePerKg: { type: Number, required: true, min: 0.01 },
    amountPaid: { type: Number, default: 0 },
    paidAmount: { type: Number, default: 0 },
    isPaid: { type: Boolean, default: false },
    paymentStatus: { type: String, default: null },
    paymentMethod: { type: String, default: null },
    // Controls how stock-in purchases are credited in GL.
    // AUTO preserves normal/manual stock-in behaviour. Historical migration stock
    // purchases can be posted through the bank-centric working-capital policy
    // during GL rebuild, while true OPENING_STOCK remains opening equity.
    glFundingTreatment: {
      type: String,
      enum: ['AUTO', 'BANK', 'OPENING_EQUITY', 'ACCOUNTS_PAYABLE'],
      default: 'AUTO',
      index: true,
    },
    loggedBy: {
      uid: { type: String, default: 'system' },
      email: { type: String, default: 'system@local' },
    },
    posting: { type: PostingSchema, default: () => ({}) },
  },
  { timestamps: true }
);

stockInSchema.index({ branchId: 1, purchaseDate: 1 });
stockInSchema.index({ branchId: 1, stockType: 1 });
stockInSchema.index({ purchaseDate: -1, 'posting.status': 1 });
stockInSchema.index({ branchId: 1, purchaseDate: -1, 'posting.status': 1 });

module.exports = mongoose.model('StockIn', stockInSchema);
