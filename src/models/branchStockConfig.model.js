// src/models/branchStockConfig.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const branchStockConfigSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4(), index: true },
    branchId: { type: String, required: true, unique: true, index: true },
    stockLocationId: { type: String, required: true, index: true },
    stockLocationName: { type: String, default: null },
    serviceZoneIds: { type: [String], default: [] },
    defaultProductId: { type: String, default: null },
    defaultProductSku: { type: String, default: null },
    cogsEnabled: { type: Boolean, default: false, index: true },
    cogsActivatedAt: { type: Date, default: null },
    cogsActivatedBy: { type: String, default: null },
    cogsActivationNote: { type: String, default: null },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: String, default: null },
    updatedBy: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('BranchStockConfig', branchStockConfigSchema);
