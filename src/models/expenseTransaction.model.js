const mongoose = require('mongoose');

const PostingSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ['UNPOSTED', 'QUEUED', 'POSTED', 'FAILED', 'SKIPPED', 'REVERSED'],
      default: 'UNPOSTED',
      index: true,
    },
    glEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'GeneralLedgerEntry', default: null },
    glEntryIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'GeneralLedgerEntry' }],
    postedAt: { type: Date, default: null },
    postedBy: { type: String, default: null },
    attempts: { type: Number, default: 0 },
    errorCode: { type: String, default: null },
    errorMessage: { type: String, default: null },
    version: { type: Number, default: 1 },
    reversedAt: { type: Date, default: null },
    reversedBy: { type: String, default: null },
    reversalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'GeneralLedgerEntry', default: null },
  },
  { _id: false }
);

const expenseTransactionSchema = new mongoose.Schema(
  {
    dailySummaryId: { type: mongoose.Schema.Types.ObjectId, ref: 'DailySummary', required: true, index: true },

    // Keep string to support ObjectId strings and service-zone/branch keys.
    branchId: { type: String, required: true, index: true },
    cashierId: { type: String, required: true, index: true },
    cashierName: { type: String, default: null, trim: true },

    category: {
      type: String,
      enum: [
        'STAFF',
        'LOGISTICS',
        'UTILITIES',
        'MAINTENANCE',
        'MARKETING',
        'ADMIN',
        'FUEL',
        'SALARIES',
        'MISCELLANEOUS',
        'Fuel',
        'Maintenance',
        'Salaries',
        'Utilities',
        'Miscellaneous',
      ],
      required: true,
      index: true,
    },

    paymentDisposition: {
      type: String,
      enum: ['CASH', 'TRANSFER', 'POS', 'UNPAID', 'AP', 'PAYABLE', null],
      default: 'CASH',
      index: true,
    },

    description: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0.01 },
    isReconciled: { type: Boolean, default: false },
    date: { type: Date, required: true, default: Date.now, index: true },

    status: {
      type: String,
      enum: ['draft', 'pending_approval', 'approved', 'rejected', 'voided', 'reversed'],
      default: 'draft',
      index: true,
    },
    approvedBy: { type: String, default: null },
    approvedAt: { type: Date, default: null },
    rejectedBy: { type: String, default: null },
    rejectedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null },


    voiding: {
      isVoided: { type: Boolean, default: false, index: true },
      voidedAt: { type: Date, default: null },
      voidedBy: { type: String, default: null },
      voidReason: { type: String, default: null },
      originalStatus: { type: String, default: null },
      correctionRef: { type: String, default: null },
    },

    posting: { type: PostingSchema, default: () => ({}) },
  },
  { timestamps: true }
);

expenseTransactionSchema.index({ branchId: 1, date: 1, status: 1 });
expenseTransactionSchema.index({ dailySummaryId: 1, date: 1 });

module.exports = mongoose.model('ExpenseTransaction', expenseTransactionSchema);
