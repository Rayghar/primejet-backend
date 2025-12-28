const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

// <<-- NEW: Define the schema for a single price override -->>
const priceOverrideSchema = new mongoose.Schema({
  cylinderId: { type: String, required: true }, // e.g., 'gc_5kg'
  newPrice: { type: Number, required: true, min: 0 } // Price in kobo
}, { _id: false });


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
  deliveryFee: {
    type: Number, 
    required: true,
    min: 0,
    default: 50000
  },
  expressSurcharge: {
    type: Number,
    required: true,
    min: 0,
    default: 20000
  },
  // <<-- NEW: Add the priceOverrides array to the main schema -->>
  priceOverrides: {
    type: [priceOverrideSchema],
    default: []
  },
}, {
  timestamps: true
});

serviceZoneSchema.index({ area: '2dsphere' });

module.exports = mongoose.model('ServiceZone', serviceZoneSchema);