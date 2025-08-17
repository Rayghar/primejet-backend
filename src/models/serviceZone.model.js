// File: src/models/serviceZone.model.js
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
      type: [[[Number]]],
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
  }
}, {
  timestamps: true
});

serviceZoneSchema.index({ area: '2dsphere' });

module.exports = mongoose.model('ServiceZone', serviceZoneSchema);