const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const migrationBatchSchema = new mongoose.Schema(
  {
    batchId: { type: String, unique: true, required: true, default: uuidv4, index: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    sourceType: { type: String, enum: ['CSV_EXCEL', 'JSON', 'MANUAL'], default: 'CSV_EXCEL', index: true },
    status: {
      type: String,
      enum: ['UPLOADED', 'VALIDATED', 'READY_FOR_REVIEW', 'DRY_RUN_COMPLETE', 'IMPORTING', 'IMPORTED', 'PARTIALLY_IMPORTED', 'FAILED', 'CANCELLED'],
      default: 'UPLOADED',
      index: true,
    },
    dateRange: {
      startDate: { type: Date, default: null },
      endDate: { type: Date, default: null },
    },
    uploadedBy: { type: String, default: null, index: true },
    uploadedByName: { type: String, default: null },
    sourceFileName: { type: String, default: null },
    uploadDate: { type: Date, default: Date.now, index: true },
    options: {
      createBranches: { type: Boolean, default: true },
      createMissingDailySummaryForExpenses: { type: Boolean, default: true },
      allowHistoricalNegativeStock: { type: Boolean, default: true },
      importStockDepletionMovements: { type: Boolean, default: true },
      skipDuplicates: { type: Boolean, default: true },
      queueForGlPosting: { type: Boolean, default: false },
    },
    totals: {
      records: { type: Number, default: 0 },
      ready: { type: Number, default: 0 },
      warnings: { type: Number, default: 0 },
      blocked: { type: Number, default: 0 },
      duplicates: { type: Number, default: 0 },
      imported: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
    },
    dryRun: {
      ranAt: { type: Date, default: null },
      summary: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
    importSummary: { type: mongoose.Schema.Types.Mixed, default: {} },
    lastError: { type: String, default: null },
  },
  { timestamps: true }
);

migrationBatchSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('MigrationBatch', migrationBatchSchema);
