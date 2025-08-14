// src/models/van.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const vanSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      unique: true,
      default: () => uuidv4(),
      index: true,
    },
    vanNumber: { // A unique identifier for the van (e.g., "VAN001")
      type: String,
      required: [true, 'Van number is required.'],
      unique: true,
      trim: true,
      maxlength: [20, 'Van number cannot exceed 20 characters.'],
    },
    driverId: { // Current driver assigned to this van
      type: String,
      ref: 'User', // References the User model (assuming 'id' is the User's primary key)
      index: true,
      sparse: true, // Allows null if no driver is assigned
    },
    driverName: { // Snapshot of driver's name for easier display
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ['Idle', 'On Delivery', 'Returning', 'Maintenance', 'Offline'],
      default: 'Idle',
      index: true,
    },
    currentOrderId: { // The ID of the order currently being delivered, if any
      type: String,
      ref: 'Order',
      sparse: true,
    },
    location: { // Current location (e.g., depot name or last known area)
      type: String,
      trim: true,
      maxlength: [100, 'Location cannot exceed 100 characters.'],
    },
    destination: { // Current delivery destination, if on a run
      type: String,
      trim: true,
      maxlength: [100, 'Destination cannot exceed 100 characters.'],
      sparse: true,
    },
    // Optional: vehicle details (make, model, license plate), capacity, etc.
  },
  {
    timestamps: true, // Adds createdAt and updatedAt
  }
);

const Van = mongoose.model('Van', vanSchema);

module.exports = Van;