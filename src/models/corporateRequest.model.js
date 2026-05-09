// File: src/models/corporateRequest.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const timelineSchema = new mongoose.Schema(
  {
    status: { type: String, trim: true },
    note: { type: String, trim: true, maxlength: 500 },
    timestamp: { type: Date, default: Date.now },
    updatedBy: { type: String, trim: true },
    updatedByName: { type: String, trim: true },
  },
  { _id: false }
);

const cylinderLineSchema = new mongoose.Schema(
  {
    sizeKg: { type: Number, min: 0 },
    quantity: { type: Number, min: 0 },
  },
  { _id: false }
);

const corporateRequestSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4(), index: true },
    requestCode: { type: String, trim: true, uppercase: true, unique: true, sparse: true, index: true },
    clientId: { type: String, required: true, ref: 'CorporateClient', index: true },
    clientName: { type: String, trim: true, index: true },
    siteId: { type: String, ref: 'CorporateSite', trim: true, index: true },
    siteName: { type: String, trim: true, maxlength: 150 },
    deliveryAddress: { type: String, trim: true, maxlength: 300 },
    requestType: {
      type: String,
      enum: ['BULK_REFILL', 'CYLINDER_REFILL', 'CYLINDER_EXCHANGE', 'EQUIPMENT_SUPPLY', 'RECURRING_REFILL', 'OTHER'],
      default: 'BULK_REFILL',
      index: true,
    },
    priority: {
      type: String,
      enum: ['NORMAL', 'HIGH', 'URGENT', 'SCHEDULED_CONTRACT'],
      default: 'NORMAL',
      index: true,
    },
    requestSource: {
      type: String,
      enum: ['BUSINESS_PORTAL', 'BMA_ADMIN', 'WHATSAPP', 'RELATIONSHIP_MANAGER', 'PHONE_CALL', 'EMAIL', 'OTHER'],
      default: 'BUSINESS_PORTAL',
      index: true,
    },
    requestedKg: { type: Number, default: 0, min: 0 },
    cylinderLines: { type: [cylinderLineSchema], default: [] },
    requestedDeliveryDate: { type: Date, index: true },
    preferredDeliveryWindow: { type: String, trim: true, maxlength: 150 },
    paymentType: {
      type: String,
      enum: ['PREPAID', 'PAY_ON_DELIVERY', 'CREDIT', 'ACCOUNT_TERMS'],
      default: 'ACCOUNT_TERMS',
      index: true,
    },
    poNumber: { type: String, trim: true, maxlength: 120, index: true },
    deliveryContactName: { type: String, trim: true, maxlength: 120 },
    deliveryContactPhone: { type: String, trim: true },
    notes: { type: String, trim: true, maxlength: 1500 },
    internalNote: { type: String, trim: true, maxlength: 1500 },
    estimatedPricePerKg: { type: Number, default: 0, min: 0 },
    estimatedAmount: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'QUOTED', 'APPROVED', 'SCHEDULED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED', 'REJECTED'],
      default: 'SUBMITTED',
      index: true,
    },
    requiresClientApproval: { type: Boolean, default: false, index: true },
    approvedByClientUserId: { type: String, trim: true },
    approvedByClientUserName: { type: String, trim: true },
    approvedAt: { type: Date },
    reviewedBy: { type: String, trim: true },
    reviewedByName: { type: String, trim: true },
    reviewedAt: { type: Date },
    scheduledAt: { type: Date, index: true },
    deliveredAt: { type: Date, index: true },
    linkedFulfilmentId: { type: String, trim: true, index: true, sparse: true },
    linkedFulfilmentCode: { type: String, trim: true },
    createdBy: { type: String, trim: true },
    createdByName: { type: String, trim: true },
    updatedBy: { type: String, trim: true },
    statusHistory: { type: [timelineSchema], default: [] },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

corporateRequestSchema.index({ clientId: 1, createdAt: -1 });
corporateRequestSchema.index({ clientId: 1, status: 1, requestedDeliveryDate: 1 });
corporateRequestSchema.index({ status: 1, requestedDeliveryDate: 1 });
corporateRequestSchema.index({ requestCode: 'text', clientName: 'text', siteName: 'text', poNumber: 'text' });

corporateRequestSchema.pre('save', function (next) {
  if (!this.requestCode) {
    const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    this.requestCode = `B2B-REQ-${stamp}-${String(this.id || uuidv4()).slice(0, 6).toUpperCase()}`;
  }
  const kg = Number(this.requestedKg || 0);
  const price = Number(this.estimatedPricePerKg || 0);
  this.estimatedAmount = Math.max(0, kg * price);
  next();
});

module.exports = mongoose.models.CorporateRequest || mongoose.model('CorporateRequest', corporateRequestSchema);
