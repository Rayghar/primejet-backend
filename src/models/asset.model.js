// src/models/asset.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const assetSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      unique: true,
      default: () => uuidv4(),
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Asset name is required.'],
      trim: true,
      minlength: [3, 'Asset name must be at least 3 characters.'],
      maxlength: [100, 'Asset name cannot exceed 100 characters.'],
    },
    type: {
      type: String,
      enum: ['Plant', 'Delivery Van', 'Bobtail Truck', 'Office Equipment', 'Other'],
      required: [true, 'Asset type is required.'],
    },
    cost: {
      type: Number,
      required: [true, 'Asset cost is required.'],
      min: [0, 'Cost cannot be negative.'],
    },
    purchaseDate: {
      type: Date,
      required: [true, 'Purchase date is required.'],
    },
    // Optional: depreciation rate, current value, etc.
  },
  {
    timestamps: true, // Adds createdAt and updatedAt
  }
);

const Asset = mongoose.model('Asset', assetSchema);

module.exports = Asset;