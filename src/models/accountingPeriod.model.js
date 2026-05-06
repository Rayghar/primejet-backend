const mongoose = require('mongoose');

const accountingPeriodSchema = new mongoose.Schema(
  {
    periodKey: { type: String, required: true, unique: true, index: true },
    status: { type: String, enum: ['OPEN', 'LOCKED'], default: 'OPEN', index: true },
    lockedAt: { type: Date, default: null },
    lockedBy: { type: String, default: null },
    lockReason: { type: String, default: null },
    reopenedAt: { type: Date, default: null },
    reopenedBy: { type: String, default: null },
    reopenReason: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AccountingPeriod', accountingPeriodSchema);
