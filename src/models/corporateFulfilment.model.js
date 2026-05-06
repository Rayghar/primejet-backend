// File: src/models/corporateFulfilment.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const milestoneSchema = new mongoose.Schema(
  {
    status: { type: String, trim: true },
    note: { type: String, trim: true, maxlength: 500 },
    timestamp: { type: Date, default: Date.now },
    updatedBy: { type: String, trim: true },
    updatedByName: { type: String, trim: true },
  },
  { _id: false }
);

const corporateFulfilmentSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4(), index: true },
    orderCode: { type: String, trim: true, uppercase: true, unique: true, sparse: true, index: true },
    clientId: { type: String, required: true, ref: 'CorporateClient', index: true },
    clientName: { type: String, trim: true, index: true },
    orderType: {
      type: String,
      enum: ['BULK_REFILL', 'CYLINDER_REFILL', 'CYLINDER_EXCHANGE', 'EQUIPMENT_SUPPLY', 'OTHER'],
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
      enum: ['WHATSAPP', 'RELATIONSHIP_MANAGER', 'PHONE_CALL', 'EMAIL', 'WALK_IN', 'ADMIN_ENTRY', 'OTHER'],
      default: 'RELATIONSHIP_MANAGER',
      index: true,
    },
    requestReference: { type: String, trim: true, index: true },
    requestedKg: { type: Number, default: 0, min: 0 },
    deliveredKg: { type: Number, default: 0, min: 0 },
    sellingPricePerKg: { type: Number, default: 0, min: 0 },
    costPerKg: { type: Number, default: 0, min: 0 },
    deliveryCost: { type: Number, default: 0, min: 0 },
    revenue: { type: Number, default: 0, min: 0 },
    cogs: { type: Number, default: 0, min: 0 },
    grossMargin: { type: Number, default: 0 },
    marginPerKg: { type: Number, default: 0 },
    amountPaid: { type: Number, default: 0, min: 0 },
    outstandingAmount: { type: Number, default: 0, min: 0 },
    paymentStatus: {
      type: String,
      enum: ['UNPAID', 'PART_PAID', 'PAID', 'CREDIT', 'WAIVED'],
      default: 'UNPAID',
      index: true,
    },
    invoiceNumber: { type: String, trim: true, index: true, sparse: true },
    paymentDueDate: { type: Date, index: true },
    requestedAt: { type: Date, default: Date.now, index: true },
    promisedAt: { type: Date, index: true },
    scheduledAt: { type: Date, index: true },
    dispatchStartedAt: { type: Date, index: true },
    actualDeliveredAt: { type: Date, index: true },
    turnaroundMinutes: { type: Number, default: 0, min: 0 },
    delayMinutes: { type: Number, default: 0, min: 0 },
    slaStatus: {
      type: String,
      enum: ['NOT_DUE', 'ON_TIME', 'AT_RISK', 'LATE', 'MISSED', 'NOT_APPLICABLE'],
      default: 'NOT_DUE',
      index: true,
    },
    status: {
      type: String,
      enum: ['REQUESTED', 'SCHEDULED', 'IN_TRANSIT', 'DELIVERED', 'DELAYED', 'CANCELLED', 'FAILED'],
      default: 'REQUESTED',
      index: true,
    },
    vehicleType: {
      type: String,
      enum: ['TRUCK', 'VAN', 'THIRD_PARTY', 'NOT_ASSIGNED'],
      default: 'NOT_ASSIGNED',
      index: true,
    },
    truckId: { type: String, trim: true, index: true },
    truckName: { type: String, trim: true },
    truckTripId: { type: String, trim: true, index: true },
    vanId: { type: String, trim: true, index: true },
    vanName: { type: String, trim: true },
    driverId: { type: String, trim: true, index: true },
    driverName: { type: String, trim: true },
    relationshipManagerId: { type: String, trim: true, index: true },
    relationshipManagerName: { type: String, trim: true },
    branchId: { type: String, trim: true, index: true },
    branchName: { type: String, trim: true },
    deliveryAddress: { type: String, trim: true, maxlength: 300 },
    deliverySiteName: { type: String, trim: true, maxlength: 150 },
    linkedOrderId: { type: String, trim: true, index: true, sparse: true },
    linkedRunId: { type: String, trim: true, index: true, sparse: true },
    linkedWhatsAppDraftId: { type: String, trim: true, index: true, sparse: true },
    stockInReference: { type: String, trim: true, index: true, sparse: true },
    customerConfirmed: { type: Boolean, default: false, index: true },
    customerConfirmedAt: { type: Date },
    delayReason: { type: String, trim: true, maxlength: 500 },
    serviceNotes: { type: String, trim: true, maxlength: 1000 },
    statusHistory: { type: [milestoneSchema], default: [] },
    createdBy: { type: String, trim: true },
    updatedBy: { type: String, trim: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

corporateFulfilmentSchema.index({ clientId: 1, createdAt: -1 });
corporateFulfilmentSchema.index({ status: 1, promisedAt: 1 });
corporateFulfilmentSchema.index({ branchId: 1, status: 1 });
corporateFulfilmentSchema.index({ relationshipManagerId: 1, status: 1 });
corporateFulfilmentSchema.index({ vehicleType: 1, truckId: 1, vanId: 1 });
corporateFulfilmentSchema.index({ paymentStatus: 1, paymentDueDate: 1 });
corporateFulfilmentSchema.index({ slaStatus: 1, promisedAt: 1 });

corporateFulfilmentSchema.pre('save', function (next) {
  if (!this.orderCode) {
    const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    this.orderCode = `B2B-${stamp}-${String(this.id || uuidv4()).slice(0, 6).toUpperCase()}`;
  }

  const kg = Number(this.deliveredKg || this.requestedKg || 0);
  const price = Number(this.sellingPricePerKg || 0);
  const cost = Number(this.costPerKg || 0);
  const deliveryCost = Number(this.deliveryCost || 0);
  const paid = Number(this.amountPaid || 0);
  this.revenue = Math.max(0, kg * price);
  this.cogs = Math.max(0, kg * cost + deliveryCost);
  this.grossMargin = this.revenue - this.cogs;
  this.marginPerKg = kg > 0 ? this.grossMargin / kg : 0;
  this.outstandingAmount = Math.max(0, this.revenue - paid);

  if (this.revenue > 0) {
    if (this.paymentStatus !== 'CREDIT' && this.paymentStatus !== 'WAIVED') {
      if (this.outstandingAmount <= 0) this.paymentStatus = 'PAID';
      else if (paid > 0) this.paymentStatus = 'PART_PAID';
      else this.paymentStatus = 'UNPAID';
    }
  }

  const requestedAt = this.requestedAt ? new Date(this.requestedAt) : null;
  const promisedAt = this.promisedAt ? new Date(this.promisedAt) : null;
  const deliveredAt = this.actualDeliveredAt ? new Date(this.actualDeliveredAt) : null;
  const now = new Date();

  if (requestedAt && deliveredAt && deliveredAt >= requestedAt) {
    this.turnaroundMinutes = Math.round((deliveredAt.getTime() - requestedAt.getTime()) / 60000);
  }

  if (!promisedAt) {
    this.slaStatus = 'NOT_APPLICABLE';
    this.delayMinutes = 0;
  } else if (this.status === 'DELIVERED' && deliveredAt) {
    this.delayMinutes = Math.max(0, Math.round((deliveredAt.getTime() - promisedAt.getTime()) / 60000));
    this.slaStatus = this.delayMinutes > 0 ? 'LATE' : 'ON_TIME';
  } else if (['CANCELLED', 'FAILED'].includes(this.status)) {
    this.slaStatus = 'MISSED';
    this.delayMinutes = Math.max(0, Math.round((now.getTime() - promisedAt.getTime()) / 60000));
  } else if (now > promisedAt) {
    this.delayMinutes = Math.max(0, Math.round((now.getTime() - promisedAt.getTime()) / 60000));
    this.slaStatus = 'LATE';
    if (this.status !== 'IN_TRANSIT') this.status = 'DELAYED';
  } else if (promisedAt.getTime() - now.getTime() <= 2 * 60 * 60000) {
    this.slaStatus = 'AT_RISK';
    this.delayMinutes = 0;
  } else {
    this.slaStatus = 'NOT_DUE';
    this.delayMinutes = 0;
  }

  if (this.customerConfirmed && !this.customerConfirmedAt) this.customerConfirmedAt = new Date();
  next();
});

module.exports = mongoose.models.CorporateFulfilment || mongoose.model('CorporateFulfilment', corporateFulfilmentSchema);
