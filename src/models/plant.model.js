// src/models/plant.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const plantSchema = new mongoose.Schema(
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
      required: [true, 'Plant name is required.'],
      trim: true,
      unique: true,
      minlength: [3, 'Plant name must be at least 3 characters.'],
      maxlength: [100, 'Plant name cannot exceed 100 characters.'],
    },
    capacity: { // Max LPG storage capacity in KG
      type: Number,
      required: [true, 'Capacity is required.'],
      min: [0, 'Capacity cannot be negative.'],
    },
    status: {
      type: String,
      enum: ['Operational', 'Maintenance', 'Offline', 'Warning'],
      default: 'Operational',
    },
    uptime: { // Percentage uptime (e.g., 99.9)
      type: Number,
      min: 0,
      max: 100,
      default: 100,
    },
    outputToday: { // Total KG processed today (resets daily)
      type: Number,
      min: 0,
      default: 0,
    },
    monthlyOpex: { // Monthly operational expenses (for financial calculations)
      type: Number,
      min: 0,
      default: 0,
    },
    location: { // Optional: physical address or coordinates
      latitude: { type: Number, min: -90, max: 90 },
      longitude: { type: Number, min: -180, max: 180 },
      address: { type: String, trim: true },
    },
    // NEW FIELDS FOR ENHANCEMENTS
    targetDailyOutputKg: { // Target output for the day, for performance tracking
      type: Number,
      min: 0,
      default: 1500, // Example default
    },
    lastMaintenanceDate: { // Date of the last maintenance
      type: Date,
      optional: true,
    },
    nextMaintenanceDate: { // Date of the next scheduled maintenance
      type: Date,
      optional: true,
    },
    // Could add 'maintenanceNotes', 'maintenanceIntervalDays' etc.
  },
  {
    timestamps: true,
  }
);

const Plant = mongoose.model('Plant', plantSchema);

module.exports = Plant;