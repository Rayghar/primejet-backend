// File: src/models/serviceZone.model.js
// << NEW FILE >>

const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

// Defines the structure for GeoJSON Polygons
const geoJsonPolygonSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['Polygon'],
    required: true
  },
  coordinates: {
    type: [[[[Number]]]], // Format for GeoJSON Polygons
    required: true
  }
}, { _id: false });

const serviceZoneSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4(), index: true },
    name: { type: String, required: [true, 'Zone name is required.'], trim: true },
    state: { type: String, required: [true, 'State is required.'], trim: true },
    area: {
      type: geoJsonPolygonSchema,
      required: true,
      index: '2dsphere' // << CRITICAL: This enables efficient geospatial queries
    },
    isActive: { type: Boolean, default: false, index: true },
    outOfZoneMessage: {
      type: String,
      trim: true,
      default: 'We are not yet available in your area, but we are expanding soon!'
    }
  },
  { timestamps: true }
);

const ServiceZone = mongoose.model('ServiceZone', serviceZoneSchema);
module.exports = ServiceZone;