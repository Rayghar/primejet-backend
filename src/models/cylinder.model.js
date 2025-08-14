// src/models/cylinder.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const cylinderSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      unique: true,
      default: () => uuidv4(),
      index: true,
    },
    size: { // e.g., "3kg", "5kg", "12.5kg", "50kg"
      type: String,
      required: [true, 'Cylinder size is required.'],
      trim: true,
      maxlength: [20, 'Size cannot exceed 20 characters.'],
    },
    quantity: { // Number of cylinders of this size owned/acquired
      type: Number,
      required: [true, 'Quantity is required.'],
      min: [0, 'Quantity cannot be negative.'],
    },
    // You might add fields like:
    // status: { type: String, enum: ['filled', 'empty', 'in_transit', 'leased'], default: 'filled' },
    // purchaseDate: { type: Date },
    // condition: { type: String, enum: ['new', 'good', 'damaged'] },
  },
  {
    timestamps: true,
  }
);

const Cylinder = mongoose.model('Cylinder', cylinderSchema);

module.exports = Cylinder;