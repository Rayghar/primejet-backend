// File: src/models/saleTransaction.model.js
const mongoose = require('mongoose');

const postingSchema = new mongoose.Schema(
  {
    status: { type: String, enum: ['UNPOSTED', 'QUEUED', 'POSTED', 'FAILED', 'SKIPPED', 'REVERSED'], default: 'UNPOSTED', index: true },
    glEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'GeneralLedgerEntry', default: null },
    glEntryIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'GeneralLedgerEntry' }],
    postedAt: { type: Date, default: null },
    postedBy: { type: String, default: null },
    attempts: { type: Number, default: 0 },
    errorCode: { type: String, default: null },
    errorMessage: { type: String, default: null },
    version: { type: Number, default: 1 },
  },
  { _id: false }
);

const priceOverrideSchema = new mongoose.Schema(
  {
    isOverride: { type: Boolean, default: false, index: true },
    configuredPricePerKg: { type: Number, default: 0 },
    enteredPricePerKg: { type: Number, default: 0 },
    variancePerKg: { type: Number, default: 0 },
    reason: { type: String, default: null, trim: true },
    approvalStatus: { type: String, enum: ['NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED'], default: 'NOT_REQUIRED' },
    approvedBy: { type: String, default: null },
    approvedAt: { type: Date, default: null },
  },
  { _id: false }
);

const saleTransactionSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true, default: Date.now, index: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plant', required: true, index: true },
    dailySummaryId: { type: mongoose.Schema.Types.ObjectId, ref: 'DailySummary', default: null, index: true },

    productId: { type: String, default: null, index: true },
    productSku: { type: String, default: null, index: true },
    productName: { type: String, default: null },

    kgSold: { type: Number, required: true, min: 0 },
    pricePerKg: { type: Number, required: true, min: 0 },

    totalRevenue: { type: Number, required: true, min: 0 },
    cashAmount: { type: Number, default: 0, min: 0 },
    transferAmount: { type: Number, default: 0, min: 0 },
    posAmount: { type: Number, default: 0, min: 0 },

    paymentMethod: { type: String, enum: ['CASH', 'TRANSFER', 'POS'], required: true, index: true },

    priceOverride: { type: priceOverrideSchema, default: () => ({}) },

    status: { type: String, enum: ['draft', 'pending_approval', 'approved', 'rejected', 'voided', 'reversed'], default: 'draft', index: true },

    receiptNumber: { type: String, default: null, index: true },
    cashierId: { type: String, default: null, index: true },
    cashierName: { type: String, default: null, trim: true },

    voiding: {
      isVoided: { type: Boolean, default: false, index: true },
      voidedAt: { type: Date, default: null },
      voidedBy: { type: String, default: null },
      voidReason: { type: String, default: null },
      originalStatus: { type: String, default: null },
      correctionRef: { type: String, default: null },
    },
    posting: { type: postingSchema, default: () => ({}) },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

saleTransactionSchema.virtual('amount').get(function amount() { return this.totalRevenue; });
saleTransactionSchema.virtual('transactionType').get(function transactionType() { return this.paymentMethod; });

saleTransactionSchema.pre('validate', function deriveSplit(next) {
  const method = String(this.paymentMethod || '').toUpperCase();
  const amount = Number(this.totalRevenue || 0);
  if (amount > 0 && method) {
    if (method === 'CASH' && !this.cashAmount) this.cashAmount = amount;
    if (method === 'TRANSFER' && !this.transferAmount) this.transferAmount = amount;
    if (method === 'POS' && !this.posAmount) this.posAmount = amount;
  }
  next();
});

saleTransactionSchema.index({ branchId: 1, date: 1 });
saleTransactionSchema.index({ dailySummaryId: 1, date: 1 });
saleTransactionSchema.index({ productId: 1, date: 1 });

module.exports = mongoose.model('SaleTransaction', saleTransactionSchema);
