// File: src/models/chartOfAccount.model.js
const mongoose = require('mongoose');

const chartOfAccountSchema = new mongoose.Schema(
  {
    accountCode: { type: String, required: true, trim: true, index: true },
    name: { type: String, required: true, trim: true },
    type: {
      type: String,
      required: true,
      enum: ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'],
      index: true,
    },
    normalBalance: { type: String, required: true, enum: ['DEBIT', 'CREDIT'] },
    category: { type: String, default: null, trim: true }, // CASH, BANK, AR, AP, INVENTORY, REVENUE, COGS, OPEX, etc.
    description: { type: String, default: null, trim: true },

    // branchScope:
    // - null => global COA
    // - string => branch-scoped COA (if you ever need branch-specific accounts)
    branchScope: { type: String, default: null, index: true },

    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

// Unique per branchScope+accountCode (null scope is allowed and treated as its own scope)
chartOfAccountSchema.index({ accountCode: 1, branchScope: 1 }, { unique: true });

module.exports = mongoose.model('ChartOfAccount', chartOfAccountSchema);