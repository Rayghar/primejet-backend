const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const serviceZoneSchema = new mongoose.Schema({
  id: {
    type: String,
    default: uuidv4,
    unique: true,
    required: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  state: {
    type: String,
    required: true,
    trim: true
  },
  area: {
    type: {
      type: String,
      enum: ['Polygon'],
      required: true
    },
    coordinates: {
      type: [[[Number]]], // Standard GeoJSON format
      required: true
    }
  },
  isActive: {
    type: Boolean,
    default: false
  },
  outOfZoneMessage: {
    type: String,
    required: true,
    trim: true
  },
  // <<-- NEW: Add pricing fields to each zone -->>
  deliveryFee: {
    type: Number, // Stored in the smallest currency unit (e.g., kobo)
    required: true,
    min: 0,
    default: 50000 // e.g., ₦500.00
  },
  expressSurcharge: {
    type: Number, // Stored in kobo
    required: true,
    min: 0,
    default: 20000 // e.g., ₦200.00
  }
}, {
  timestamps: true
});

serviceZoneSchema.index({ area: '2dsphere' });

module.exports = mongoose.model('ServiceZone', serviceZoneSchema);