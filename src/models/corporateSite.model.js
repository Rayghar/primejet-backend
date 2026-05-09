// File: src/models/corporateSite.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const corporateSiteSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4(), index: true },
    clientId: { type: String, required: true, ref: 'CorporateClient', index: true },
    clientName: { type: String, trim: true, index: true },
    siteName: { type: String, required: true, trim: true, maxlength: 150, index: true },
    siteType: {
      type: String,
      enum: ['HEAD_OFFICE', 'BRANCH', 'KITCHEN', 'RESTAURANT', 'HOTEL', 'ESTATE', 'SCHOOL', 'FACTORY', 'OTHER'],
      default: 'OTHER',
      index: true,
    },
    address: { type: String, required: true, trim: true, maxlength: 300 },
    city: { type: String, trim: true, maxlength: 80, default: 'Lagos' },
    state: { type: String, trim: true, maxlength: 80, default: 'Lagos' },
    latitude: { type: Number, min: -90, max: 90 },
    longitude: { type: Number, min: -180, max: 180 },
    siteContactName: { type: String, trim: true, maxlength: 120 },
    siteContactPhone: { type: String, trim: true },
    siteContactEmail: { type: String, trim: true, lowercase: true },
    preferredDeliveryWindow: { type: String, trim: true, maxlength: 150 },
    deliveryInstructions: { type: String, trim: true, maxlength: 1000 },
    assignedBranchId: { type: String, trim: true, index: true },
    assignedBranchName: { type: String, trim: true },
    defaultProductType: {
      type: String,
      enum: ['BULK_LPG', 'CYLINDER_REFILL', 'CYLINDER_EXCHANGE', 'MIXED', 'OTHER'],
      default: 'BULK_LPG',
    },
    estimatedMonthlyKg: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ['ACTIVE', 'PENDING_REVIEW', 'INACTIVE', 'ON_HOLD'],
      default: 'ACTIVE',
      index: true,
    },
    createdBy: { type: String, trim: true },
    updatedBy: { type: String, trim: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

corporateSiteSchema.index({ clientId: 1, status: 1 });
corporateSiteSchema.index({ clientId: 1, siteName: 1 }, { unique: true });
corporateSiteSchema.index({ siteName: 'text', address: 'text', clientName: 'text' });

module.exports = mongoose.models.CorporateSite || mongoose.model('CorporateSite', corporateSiteSchema);
