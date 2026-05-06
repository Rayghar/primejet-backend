// File: src/models/whatsappActionRequest.model.js
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

const whatsappActionRequestSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4(), index: true },
    requestNo: {
      type: String,
      unique: true,
      sparse: true,
      default: () => `WA-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      index: true,
    },
    waId: { type: String, required: true, index: true },
    phone: { type: String, required: true, index: true },
    customerId: { type: String, ref: 'User', index: true, sparse: true },
    customerName: { type: String, trim: true },
    orderId: { type: String, ref: 'Order', index: true, sparse: true },
    supportTicketId: { type: String, ref: 'SupportTicket', index: true, sparse: true },
    orderDraftId: { type: String, ref: 'WhatsAppOrderDraft', index: true, sparse: true },
    requestType: {
      type: String,
      enum: ['ORDER_STATUS', 'NEW_ORDER', 'REORDER', 'PAYMENT_HELP', 'WALLET_HELP', 'COMPLAINT', 'SPEAK_TO_AGENT', 'ORDER_DRAFT', 'ORDER_DRAFT_CONFIRMED', 'CUSTOMER_LINK', 'GENERAL_MENU', 'UNKNOWN'],
      default: 'UNKNOWN',
      index: true,
    },
    status: {
      type: String,
      enum: ['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED', 'ESCALATED'],
      default: 'OPEN',
      index: true,
    },
    priority: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'], default: 'MEDIUM', index: true },
    subject: { type: String, trim: true, maxlength: 200 },
    lastInboundText: { type: String, trim: true, maxlength: 2000 },
    botResponse: { type: String, trim: true, maxlength: 5000 },
    assignedTeam: { type: String, enum: ['SUPPORT', 'OPERATIONS', 'FINANCE', 'SALES', 'ADMIN', 'BOT'], default: 'BOT', index: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    activity: { type: [activitySchema], default: [] },
    resolvedAt: { type: Date },
  },
  { timestamps: true }
);

whatsappActionRequestSchema.index({ status: 1, requestType: 1, createdAt: -1 });
whatsappActionRequestSchema.index({ phone: 1, createdAt: -1 });

module.exports = mongoose.model('WhatsAppActionRequest', whatsappActionRequestSchema);
