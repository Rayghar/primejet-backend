const mongoose = require('mongoose');

const migrationStagingRecordSchema = new mongoose.Schema(
  {
    batchId: { type: String, required: true, index: true },
    recordType: {
      type: String,
      required: true,
      enum: ['BRANCH', 'OPENING_STOCK', 'STOCK_PURCHASE', 'DAILY_SALE', 'EXPENSE', 'STOCK_VARIANCE'],
      index: true,
    },
    sourceSheet: { type: String, default: null, index: true },
    sourceRowNumber: { type: Number, default: null },
    rawRow: { type: mongoose.Schema.Types.Mixed, default: {} },
    normalized: { type: mongoose.Schema.Types.Mixed, default: {} },
    businessDate: { type: Date, default: null, index: true },
    branchCode: { type: String, default: null, index: true },
    branchName: { type: String, default: null },
    branchObjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plant', default: null, index: true },
    duplicateKey: { type: String, default: null, index: true },
    validationStatus: {
      type: String,
      enum: ['READY', 'WARNING', 'BLOCKED', 'DUPLICATE'],
      default: 'READY',
      index: true,
    },
    validationErrors: { type: [String], default: [] },
    warnings: { type: [String], default: [] },
    importStatus: {
      type: String,
      enum: ['PENDING', 'IMPORTED', 'FAILED', 'SKIPPED'],
      default: 'PENDING',
      index: true,
    },
    importedModel: { type: String, default: null },
    importedId: { type: String, default: null },
    importError: { type: String, default: null },
  },
  { timestamps: true }
);

migrationStagingRecordSchema.index({ batchId: 1, recordType: 1, sourceRowNumber: 1 });
migrationStagingRecordSchema.index({ batchId: 1, validationStatus: 1 });
migrationStagingRecordSchema.index({ batchId: 1, importStatus: 1 });

module.exports = mongoose.model('MigrationStagingRecord', migrationStagingRecordSchema);
