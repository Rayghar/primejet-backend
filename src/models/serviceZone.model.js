// File: src/models/serviceZone.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const serviceZoneSchema = new mongoose.Schema({
  id: {
    type: String,
    default: () => uuidv4(),
    unique: true,
    required: true,
  },
  name: {
    type: String,
    required: [true, 'Zone name is required.'],
    trim: true,
    unique: true,
  },
  state: {
    type: String,
    required: [true, 'State is required.'],
    trim: true,
  },
  area: {
    type: {
      type: String,
      enum: ['Polygon'],
      required: true
    },
    coordinates: {
      type: [[[[Number]]]], // For Polygon
      required: true
    }
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  outOfZoneMessage: {
    type: String,
    default: 'Sorry, your address is outside our current service area.',
  },
  
  // ======================= NEW FIELDS START HERE =======================
  deliveryFee: {
    type: Number,
    required: [true, 'A delivery fee is required for the zone.'],
    min: [0, 'Delivery fee cannot be negative.'],
    default: 0 // Stored in smallest currency unit (kobo)
  },
  expressSurcharge: {
    type: Number,
    required: [true, 'An express surcharge is required for the zone.'],
    min: [0, 'Express surcharge cannot be negative.'],
    default: 0 // Stored in smallest currency unit (kobo)
  },
  // ======================== NEW FIELDS END HERE ========================
  
}, { timestamps: true });

serviceZoneSchema.index({ area: '2dsphere' });

module.exports = mongoose.model('ServiceZone', serviceZoneSchema);