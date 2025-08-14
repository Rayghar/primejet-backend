// src/models/maintenanceLog.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const maintenanceLogSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      unique: true,
      default: () => uuidv4(),
      index: true,
    },
    plantId: {
      type: String,
      required: [true, 'Plant ID is required.'],
      ref: 'Plant',
      index: true,
    },
    type: { // e.g., 'Routine', 'Emergency', 'Repair', 'Upgrade'
      type: String,
      enum: ['Routine', 'Emergency', 'Repair', 'Upgrade', 'Inspection', 'Other'],
      required: [true, 'Maintenance type is required.'],
    },
    description: {
      type: String,
      required: [true, 'Description is required.'],
      trim: true,
      maxlength: [500, 'Description cannot exceed 500 characters.'],
    },
    startDate: {
      type: Date,
      required: [true, 'Start date is required.'],
    },
    endDate: { // Optional, for completed maintenance
      type: Date,
      optional: true,
    },
    cost: {
      type: Number,
      min: 0,
      default: 0,
    },
    performedBy: { // User or team who performed maintenance
      type: String,
      trim: true,
      maxlength: [100, 'Performed by cannot exceed 100 characters.'],
    },
    status: {
      type: String,
      enum: ['Scheduled', 'In Progress', 'Completed', 'Canceled'],
      default: 'Scheduled',
    },
    // Optional: notes, next due date suggestion
  },
  {
    timestamps: true,
  }
);

const MaintenanceLog = mongoose.model('MaintenanceLog', maintenanceLogSchema);

module.exports = MaintenanceLog;