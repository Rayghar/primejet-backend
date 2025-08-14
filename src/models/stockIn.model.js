// src/models/stockIn.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const stockInSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      unique: true,
      default: () => uuidv4(),
      index: true,
    },
    quantityKg: {
      type: Number,
      required: [true, 'Quantity in KG is required.'],
      min: [0, 'Quantity cannot be negative.'],
    },
    remainingKg: { // Track remaining quantity from this batch for FIFO/inventory
      type: Number,
      required: true,
      min: [0, 'Remaining quantity cannot be negative.'],
    },
    supplier: {
      type: String,
      required: [true, 'Supplier is required.'],
      trim: true,
      maxlength: [100, 'Supplier name cannot exceed 100 characters.'],
    },
    purchaseDate: {
      type: Date,
      required: [true, 'Purchase date is required.'],
    },
    costPerKg: {
      type: Number,
      required: [true, 'Cost per KG is required.'],
      min: [0, 'Cost per KG cannot be negative.'],
    },
    targetSalePricePerKg: {
      type: Number,
      required: [true, 'Target sale price per KG is required.'],
      min: [0, 'Target sale price per KG cannot be negative.'],
    },
    loggedBy: { // User who recorded this stock-in
      uid: { type: String, required: true },
      email: { type: String, required: true },
    },
  },
  {
    timestamps: true,
  }
);

const StockIn = mongoose.model('StockIn', stockInSchema);

module.exports = StockIn;