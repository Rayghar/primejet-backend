const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const postingBatchSchema = new mongoose.Schema(
  {
    batchId: { type: String, required: true, unique: true, default: () => `PB-${uuidv4()}`, index: true },
    action: { type: String, enum: ['POST_APPROVED', 'RETRY_FAILED', 'REBUILD'], required: true, index: true },
    status: { type: String, enum: ['STARTED', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED'], default: 'STARTED', index: true },
    branchKey: { type: String, default: null, index: true },
    startDate: { type: Date, default: null, index: true },
    endDate: { type: Date, default: null, index: true },
    businessDate: { type: Date, default: null, index: true },
    requestedBy: { type: String, default: 'system' },
    found: { type: mongoose.Schema.Types.Mixed, default: {} },
    stats: { type: mongoose.Schema.Types.Mixed, default: {} },
    results: { type: [mongoose.Schema.Types.Mixed], default: [] },
    journalIds: { type: [String], default: [] },
    errorMessage: { type: String, default: null },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

postingBatchSchema.index({ branchKey: 1, businessDate: -1 });
postingBatchSchema.index({ action: 1, createdAt: -1 });

module.exports = mongoose.model('PostingBatch', postingBatchSchema);
