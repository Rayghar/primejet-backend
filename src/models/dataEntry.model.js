// src/models/dataEntry.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const dataEntrySchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      unique: true,
      default: () => uuidv4(),
      index: true,
    },
    type: {
      type: String,
      enum: ['sale', 'expense'],
      required: [true, 'Entry type is required.'],
    },
    branchId: {
      type: String,
      required: [true, 'Branch ID is required.'],
      ref: 'Plant', // Assuming 'Plant' model has an 'id' field
      index: true,
    },
    date: {
      type: Date,
      required: [true, 'Date of entry is required.'],
      index: true,
    },
    // Fields for 'sale' type
    kgSold: { type: Number, min: 0 },
    revenue: { type: Number, min: 0 },
    paymentMethod: { type: String },
    // Fields for 'expense' type
    description: { type: String, trim: true },
    amount: { type: Number, min: 0 },
    category: { type: String },
    // Common fields
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },
    submittedBy: {
      uid: { type: String, required: true },
      email: { type: String, required: true },
    },
    submittedAt: { type: Date, default: Date.now },
    dailySummaryId: { // Link to the DailySummary this entry belongs to
      type: String,
      ref: 'DailySummary',
      index: true,
      sparse: true, // Allows nulls for entries not part of a daily summary
    },
    reviewedBy: { // User who reviewed this entry (e.g., admin)
      uid: { type: String },
      email: { type: String },
    },
    reviewedAt: { type: Date },
    isHistorical: { type: Boolean, default: false }, // Flag for data migration entries
  },
  {
    timestamps: true,
  }
);

const DataEntry = mongoose.model('DataEntry', dataEntrySchema);

module.exports = DataEntry;