// src/models/stockMovement.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const stockMovementSchema = new mongoose.Schema(
  {
    movementId: { type: String, unique: true, default: uuidv4, index: true },
    branchId: { type: String, required: true, index: true },
    movementDate: { type: Date, required: true, index: true },
    movementType: {
      type: String,
      enum: ['OPENING_STOCK', 'STOCK_IN', 'SALE_DEPLETION', 'ORDER_DEPLETION', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'RECONCILIATION_VARIANCE'],
      required: true,
      index: true,
    },
    direction: { type: String, enum: ['IN', 'OUT'], required: true, index: true },
    quantityKg: { type: Number, required: true, min: 0 },
    unitCost: { type: Number, default: 0, min: 0 },
    totalCost: { type: Number, default: 0, min: 0 },
    runningQuantityKg: { type: Number, default: null },
    runningValue: { type: Number, default: null },
    sourceType: { type: String, required: true, index: true },
    sourceId: { type: String, required: true, index: true },
    sourceRef: { type: String, default: null },
    narration: { type: String, default: '' },
    createdBy: { type: String, default: null },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

stockMovementSchema.index({ branchId: 1, movementDate: 1 });
stockMovementSchema.index({ sourceType: 1, sourceId: 1, movementType: 1 }, { unique: true });

module.exports = mongoose.model('StockMovement', stockMovementSchema);
