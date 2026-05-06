// File: src/models/whatsappMessageLog.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const whatsappMessageLogSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4(), index: true },
    providerMessageId: { type: String, index: true, sparse: true },
    waId: { type: String, index: true },
    phone: { type: String, index: true },
    direction: { type: String, enum: ['INBOUND', 'OUTBOUND'], required: true, index: true },
    messageType: {
      type: String,
      enum: ['TEXT', 'INTERACTIVE', 'BUTTON', 'LIST', 'TEMPLATE', 'STATUS', 'SYSTEM', 'UNKNOWN'],
      default: 'TEXT',
      index: true,
    },
    text: { type: String, trim: true, maxlength: 5000 },
    intent: { type: String, trim: true, index: true },
    status: {
      type: String,
      enum: ['RECEIVED', 'QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'DRY_RUN'],
      default: 'RECEIVED',
      index: true,
    },
    errorMessage: { type: String, trim: true },
    rawPayload: { type: mongoose.Schema.Types.Mixed },
    sentPayload: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

whatsappMessageLogSchema.index({ providerMessageId: 1 }, { sparse: true });
whatsappMessageLogSchema.index({ phone: 1, createdAt: -1 });
whatsappMessageLogSchema.index({ direction: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('WhatsAppMessageLog', whatsappMessageLogSchema);
