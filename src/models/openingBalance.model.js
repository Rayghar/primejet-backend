// src/models/openingBalance.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const openingBalanceSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4(), index: true },
    branchId: { type: String, default: null, index: true },
    businessDate: { type: Date, required: true, index: true },
    status: { type: String, enum: ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'POSTED', 'FAILED'], default: 'DRAFT', index: true },
    openingDateKey: { type: String, default: null, index: true },
    bankAccountCode: { type: String, default: null },
    cashAccountCode: { type: String, default: null },
    inventoryQuantityKg: { type: Number, default: 0 },
    inventoryCostPerKg: { type: Number, default: 0 },
    cylinderBalances: { type: [mongoose.Schema.Types.Mixed], default: [] },
    lineItems: { type: [mongoose.Schema.Types.Mixed], default: [] },
    readiness: { type: mongoose.Schema.Types.Mixed, default: {} },
    submittedBy: { type: String, default: null },
    submittedAt: { type: Date, default: null },
    approvedBy: { type: String, default: null },
    approvedAt: { type: Date, default: null },
    rejectedBy: { type: String, default: null },
    rejectedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null },
    cashOnHand: { type: Number, default: 0 },
    bankTransfers: { type: Number, default: 0 },
    bankPOS: { type: Number, default: 0 },
    inventoryValue: { type: Number, default: 0 },
    accountsReceivable: { type: Number, default: 0 },
    accountsPayable: { type: Number, default: 0 },
    openingEquity: { type: Number, default: 0 },
    notes: { type: String, default: null },
    posting: {
      status: { type: String, enum: ['UNPOSTED', 'POSTED', 'FAILED'], default: 'UNPOSTED', index: true },
      glEntryIds: { type: [String], default: [] },
      postedAt: { type: Date, default: null },
      errorMessage: { type: String, default: null },
    },
    createdBy: { type: String, default: null },
  },
  { timestamps: true }
);

openingBalanceSchema.pre('validate', function setOpeningDateKey(next) {
  if (this.businessDate) {
    const d = new Date(this.businessDate);
    if (!Number.isNaN(d.getTime())) this.openingDateKey = d.toISOString().slice(0, 10);
  }
  next();
});

openingBalanceSchema.index({ branchId: 1, openingDateKey: 1 }, { unique: true, partialFilterExpression: { openingDateKey: { $type: 'string' } } });

module.exports = mongoose.model('OpeningBalance', openingBalanceSchema);
