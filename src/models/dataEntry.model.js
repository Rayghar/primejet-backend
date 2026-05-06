// File: src/models/dataEntry.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const postingSchema = new mongoose.Schema(
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
  },
  { _id: false }
);

const dataEntrySchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      unique: true,
      default: () => uuidv4(),
      index: true,
    },

    // sale | expense (keep existing)
    type: { type: String, enum: ['sale', 'expense'], required: true, index: true },

    // Keep branchId as STRING for DataEntry (your current model does this) :contentReference[oaicite:2]{index=2}
    branchId: { type: String, required: true, index: true, ref: 'Plant' },

    // ✅ business date
    date: { type: Date, required: true, index: true },

    // sale fields
    kgSold: { type: Number, min: 0, default: 0 },
    revenue: { type: Number, min: 0, default: 0 },
    paymentMethod: { type: String, default: null },

    // expense fields
    description: { type: String, trim: true, default: null },
    amount: { type: Number, min: 0, default: 0 },
    category: { type: String, default: null },

    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },

    submittedBy: {
      uid: { type: String, required: true },
      email: { type: String, required: true },
    },
    submittedAt: { type: Date, default: Date.now },

    dailySummaryId: { type: String, ref: 'DailySummary', index: true, sparse: true },

    reviewedBy: {
      uid: { type: String },
      email: { type: String },
    },
    reviewedAt: { type: Date },

    isHistorical: { type: Boolean, default: false },

    // ✅ GL posting metadata
    posting: { type: postingSchema, default: () => ({}) },
  },
  { timestamps: true }
);

dataEntrySchema.index({ branchId: 1, date: 1 });
dataEntrySchema.index({ 'posting.status': 1, date: 1 });

module.exports = mongoose.model('DataEntry', dataEntrySchema);