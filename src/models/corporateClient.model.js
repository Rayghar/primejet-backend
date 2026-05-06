// File: src/models/corporateClient.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const activitySchema = new mongoose.Schema(
  {
    id: { type: String, default: () => uuidv4() },
    type: {
      type: String,
      enum: ['NOTE', 'CALL', 'WHATSAPP', 'EMAIL', 'VISIT', 'FOLLOW_UP', 'STAGE_CHANGE', 'SERVICE_ISSUE'],
      default: 'NOTE',
      index: true,
    },
    title: { type: String, trim: true, maxlength: 150 },
    note: { type: String, trim: true, maxlength: 2000 },
    outcome: { type: String, trim: true, maxlength: 250 },
    nextFollowUpDate: { type: Date },
    createdBy: { type: String, trim: true },
    createdByName: { type: String, trim: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const corporateClientSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4(), index: true },
    clientCode: { type: String, trim: true, uppercase: true, sparse: true, index: true },
    companyName: { type: String, required: true, trim: true, maxlength: 160, index: true },
    contactPerson: { type: String, trim: true, maxlength: 120 },
    contactRole: { type: String, trim: true, maxlength: 100 },
    phone: { type: String, trim: true, index: true },
    email: { type: String, trim: true, lowercase: true },
    industry: { type: String, trim: true, maxlength: 100, index: true },
    source: {
      type: String,
      enum: ['WHATSAPP', 'REFERRAL', 'FIELD_SALES', 'WALK_IN', 'CAMPAIGN', 'CORPORATE_OUTREACH', 'EXISTING_CUSTOMER', 'OTHER'],
      default: 'FIELD_SALES',
      index: true,
    },
    stage: {
      type: String,
      enum: ['LEAD', 'PROSPECT', 'ONBOARDING', 'ACTIVE', 'RETENTION', 'DORMANT', 'LOST'],
      default: 'LEAD',
      index: true,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'INACTIVE', 'ON_HOLD', 'BLACKLISTED'],
      default: 'ACTIVE',
      index: true,
    },
    expectedMonthlyKg: { type: Number, default: 0, min: 0 },
    estimatedMonthlyRevenue: { type: Number, default: 0, min: 0 },
    agreedPricePerKg: { type: Number, default: 0, min: 0 },
    paymentTerms: {
      type: String,
      enum: ['PAY_ON_DELIVERY', 'PREPAID', 'CREDIT_7_DAYS', 'CREDIT_14_DAYS', 'CREDIT_30_DAYS', 'CUSTOM'],
      default: 'PAY_ON_DELIVERY',
      index: true,
    },
    creditLimit: { type: Number, default: 0, min: 0 },
    slaExpectation: { type: String, trim: true, maxlength: 300 },
    address: { type: String, trim: true, maxlength: 250 },
    city: { type: String, trim: true, maxlength: 80 },
    state: { type: String, trim: true, maxlength: 80 },
    latitude: { type: Number, min: -90, max: 90 },
    longitude: { type: Number, min: -180, max: 180 },
    assignedBranchId: { type: String, trim: true, index: true },
    assignedBranchName: { type: String, trim: true },
    relationshipManagerId: { type: String, trim: true, index: true },
    relationshipManagerName: { type: String, trim: true },
    whatsappPhone: { type: String, trim: true, index: true },
    whatsappContactId: { type: String, trim: true, index: true, sparse: true },
    customerId: { type: String, trim: true, index: true, sparse: true },
    anniversaryDate: { type: Date, index: true },
    nextFollowUpDate: { type: Date, index: true },
    lastContactedAt: { type: Date },
    onboardingChecklist: {
      businessProfileCaptured: { type: Boolean, default: false },
      deliverySitesConfirmed: { type: Boolean, default: false },
      pricingApproved: { type: Boolean, default: false },
      paymentTermsApproved: { type: Boolean, default: false },
      whatsappLinked: { type: Boolean, default: false },
      firstFulfilmentCompleted: { type: Boolean, default: false },
    },
    lifetimeRequestedKg: { type: Number, default: 0, min: 0 },
    lifetimeDeliveredKg: { type: Number, default: 0, min: 0 },
    lifetimeRevenue: { type: Number, default: 0, min: 0 },
    lifetimeGrossMargin: { type: Number, default: 0 },
    fulfilmentCount: { type: Number, default: 0, min: 0 },
    openFulfilmentCount: { type: Number, default: 0, min: 0 },
    delayedFulfilmentCount: { type: Number, default: 0, min: 0 },
    outstandingBalance: { type: Number, default: 0, min: 0 },
    averageTurnaroundMinutes: { type: Number, default: 0, min: 0 },
    onTimeDeliveryRate: { type: Number, default: 0, min: 0, max: 100 },
    lastFulfilmentAt: { type: Date, index: true },
    lastOrderStatus: { type: String, trim: true },
    tags: { type: [String], default: [] },
    notes: { type: String, trim: true, maxlength: 3000 },
    activities: { type: [activitySchema], default: [] },
    createdBy: { type: String, trim: true },
    updatedBy: { type: String, trim: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

corporateClientSchema.index({ companyName: 'text', contactPerson: 'text', phone: 'text', email: 'text', industry: 'text' });
corporateClientSchema.index({ stage: 1, nextFollowUpDate: 1 });
corporateClientSchema.index({ relationshipManagerId: 1, stage: 1 });
corporateClientSchema.index({ assignedBranchId: 1, stage: 1 });
corporateClientSchema.index({ outstandingBalance: -1, lifetimeRevenue: -1 });

corporateClientSchema.pre('save', function (next) {
  if (!this.clientCode) {
    const prefix = String(this.companyName || 'CORP').replace(/[^A-Z0-9]/gi, '').slice(0, 4).toUpperCase() || 'CORP';
    this.clientCode = `${prefix}-${String(this.id || uuidv4()).slice(0, 6).toUpperCase()}`;
  }
  if (this.whatsappPhone && this.onboardingChecklist) this.onboardingChecklist.whatsappLinked = true;
  next();
});

module.exports = mongoose.models.CorporateClient || mongoose.model('CorporateClient', corporateClientSchema);
