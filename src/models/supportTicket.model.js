// File: src/models/supportTicket.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const ticketNoteSchema = new mongoose.Schema(
  {
    id: { type: String, default: () => uuidv4() },
    text: { type: String, required: true, trim: true, maxlength: 2000 },
    noteType: {
      type: String,
      enum: ['INTERNAL', 'CUSTOMER_RESPONSE', 'SYSTEM', 'ESCALATION', 'RESOLUTION'],
      default: 'INTERNAL',
    },
    authorId: { type: String, trim: true },
    authorEmail: { type: String, trim: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const ticketActivitySchema = new mongoose.Schema(
  {
    action: { type: String, required: true, trim: true },
    from: { type: String, trim: true },
    to: { type: String, trim: true },
    actorId: { type: String, trim: true },
    actorEmail: { type: String, trim: true },
    note: { type: String, trim: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const supportTicketSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      unique: true,
      default: () => uuidv4(),
      index: true,
    },
    ticketNo: {
      type: String,
      unique: true,
      sparse: true,
      default: () => `TCK-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      index: true,
    },

    customerId: { type: String, ref: 'User', index: true, sparse: true },
    customerName: { type: String, trim: true },
    customerEmail: { type: String, trim: true, lowercase: true },
    customerPhone: { type: String, trim: true },

    orderId: { type: String, ref: 'Order', index: true, sparse: true },
    runId: { type: String, ref: 'Run', index: true, sparse: true },
    stopId: { type: String, index: true, sparse: true },

    // Corporate support linkage. These fields are optional and do not affect retail tickets.
    corporateClientId: { type: String, ref: 'CorporateClient', index: true, sparse: true },
    corporateClientName: { type: String, trim: true },
    corporateRequestId: { type: String, ref: 'CorporateRequest', index: true, sparse: true },
    corporateFulfilmentId: { type: String, ref: 'CorporateFulfilment', index: true, sparse: true },
    corporateSiteId: { type: String, ref: 'CorporateSite', index: true, sparse: true },

    sourceType: {
      type: String,
      enum: ['GENERAL', 'CHAT', 'ORDER', 'FAILED_DELIVERY', 'PAYMENT', 'WALLET', 'APP_ISSUE', 'DELIVERY', 'POS', 'CORPORATE', 'OTHER'],
      default: 'GENERAL',
      index: true,
    },
    category: {
      type: String,
      enum: [
        'DELIVERY_DELAY',
        'WRONG_CYLINDER',
        'PAYMENT_ISSUE',
        'FAILED_REFILL',
        'DRIVER_CONDUCT',
        'APP_ISSUE',
        'WALLET_REFUND',
        'FAILED_DELIVERY',
        'ORDER_UPDATE',
        'GENERAL_ENQUIRY',
        'BILLING_DISPUTE',
        'QUANTITY_DISPUTE',
        'SAFETY_CONCERN',
        'CORPORATE_ACCOUNT',
        'OTHER',
      ],
      default: 'GENERAL_ENQUIRY',
      index: true,
    },

    subject: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 5000 },

    priority: {
      type: String,
      enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'],
      default: 'MEDIUM',
      index: true,
    },
    severity: {
      type: String,
      enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
      default: 'MEDIUM',
      index: true,
    },
    status: {
      type: String,
      enum: ['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'ESCALATED', 'RESOLVED', 'CLOSED'],
      default: 'OPEN',
      index: true,
    },

    assignedTeam: {
      type: String,
      enum: ['SUPPORT', 'OPERATIONS', 'FINANCE', 'ADMIN', 'UNASSIGNED'],
      default: 'SUPPORT',
      index: true,
    },
    assignedTo: { type: String, ref: 'User', index: true, sparse: true },

    sla: {
      firstResponseDueAt: { type: Date },
      resolutionDueAt: { type: Date },
      firstRespondedAt: { type: Date },
      resolvedAt: { type: Date },
      firstResponseBreached: { type: Boolean, default: false },
      resolutionBreached: { type: Boolean, default: false },
    },

    escalationReason: { type: String, trim: true, maxlength: 1000 },
    resolutionSummary: { type: String, trim: true, maxlength: 2000 },

    createdBy: { type: String, ref: 'User' },
    createdByEmail: { type: String, trim: true },
    closedAt: { type: Date },

    // Read/unread tracking for admin/customer chat reliability.
    lastCustomerMessageAt: { type: Date, index: true },
    lastAdminMessageAt: { type: Date, index: true },
    lastReadByCustomerAt: { type: Date },
    lastReadByAdminAt: { type: Date },
    unreadForAdmin: { type: Number, default: 0, min: 0 },
    unreadForCustomer: { type: Number, default: 0, min: 0 },

    notes: { type: [ticketNoteSchema], default: [] },
    activity: { type: [ticketActivitySchema], default: [] },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

supportTicketSchema.index({ customerId: 1, createdAt: -1 });
supportTicketSchema.index({ status: 1, priority: 1, createdAt: -1 });
supportTicketSchema.index({ assignedTeam: 1, status: 1, createdAt: -1 });
supportTicketSchema.index({ orderId: 1, status: 1 });
supportTicketSchema.index({ corporateClientId: 1, createdAt: -1 });
supportTicketSchema.index({ corporateFulfilmentId: 1, status: 1 });

module.exports = mongoose.model('SupportTicket', supportTicketSchema);
