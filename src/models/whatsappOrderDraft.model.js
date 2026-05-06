// File: src/models/whatsappOrderDraft.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const activitySchema = new mongoose.Schema(
  {
    action: { type: String, required: true, trim: true },
    note: { type: String, trim: true },
    actorId: { type: String, trim: true },
    actorName: { type: String, trim: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const whatsappOrderDraftSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4(), index: true },
    draftNo: {
      type: String,
      unique: true,
      sparse: true,
      default: () => `WOD-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      index: true,
    },
    waId: { type: String, required: true, index: true },
    phone: { type: String, required: true, index: true },
    customerId: { type: String, ref: 'User', index: true, sparse: true },
    customerName: { type: String, trim: true },
    customerPhone: { type: String, trim: true },
    linkedOrderId: { type: String, ref: 'Order', index: true, sparse: true },
    requestId: { type: String, ref: 'WhatsAppActionRequest', index: true, sparse: true },
    stage: {
      type: String,
      enum: [
        'WAITING_DETAILS',
        'WAITING_ADDRESS',
        'WAITING_PAYMENT_CHOICE',
        'READY_FOR_CUSTOMER_CONFIRMATION',
        'READY_FOR_ADMIN_REVIEW',
        'CONVERTED_TO_ORDER',
        'CANCELLED',
        'HANDOFF_TO_SUPPORT',
      ],
      default: 'WAITING_DETAILS',
      index: true,
    },
    status: {
      type: String,
      enum: ['OPEN', 'READY', 'SUBMITTED', 'IN_REVIEW', 'CONVERTED', 'CANCELLED', 'CLOSED'],
      default: 'OPEN',
      index: true,
    },
    cylinderSizeKg: { type: Number, min: 0 },
    quantity: { type: Number, min: 1, default: 1 },
    productText: { type: String, trim: true },
    deliveryArea: { type: String, trim: true },
    addressText: { type: String, trim: true },
    deliveryInstructions: { type: String, trim: true },
    paymentPreference: {
      type: String,
      enum: ['UNKNOWN', 'PAYSTACK_LINK', 'TRANSFER', 'CASH_ON_DELIVERY', 'WALLET', 'POS_ON_DELIVERY'],
      default: 'UNKNOWN',
      index: true,
    },
    estimatedAmount: { type: Number, default: 0, min: 0 },
    confidenceScore: { type: Number, default: 0, min: 0, max: 100 },
    lastCustomerText: { type: String, trim: true, maxlength: 2000 },
    adminNote: { type: String, trim: true },
    validationIssues: { type: [String], default: [] },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    activity: { type: [activitySchema], default: [] },
    submittedAt: { type: Date },
    convertedAt: { type: Date },
    cancelledAt: { type: Date },
  },
  { timestamps: true }
);

whatsappOrderDraftSchema.index({ phone: 1, status: 1, createdAt: -1 });
whatsappOrderDraftSchema.index({ status: 1, stage: 1, updatedAt: -1 });

module.exports = mongoose.model('WhatsAppOrderDraft', whatsappOrderDraftSchema);
