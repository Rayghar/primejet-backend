// src/models/lpgProduct.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const lpgProductSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4(), index: true },
    sku: { type: String, required: true, trim: true, uppercase: true, unique: true, index: true },
    name: { type: String, required: true, trim: true },
    productType: { type: String, enum: ['BULK_LPG', 'REFILL', 'CYLINDER', 'ACCESSORY', 'SERVICE'], default: 'BULK_LPG', index: true },
    unitOfMeasure: { type: String, enum: ['KG', 'CYLINDER', 'UNIT'], default: 'KG' },
    defaultKg: { type: Number, default: 1, min: 0 },
    defaultSellingPrice: { type: Number, default: 0, min: 0 },
    costingMethod: { type: String, enum: ['WAC', 'FIFO', 'NONE'], default: 'WAC' },
    isLpg: { type: Boolean, default: true, index: true },
    isActive: { type: Boolean, default: true, index: true },
    description: { type: String, default: null, trim: true },
    createdBy: { type: String, default: null },
    updatedBy: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('LpgProduct', lpgProductSchema);
