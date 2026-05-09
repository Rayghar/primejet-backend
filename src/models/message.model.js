// File: src/models/message.model.js
const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema(
  {
    chatId: { type: String, index: true, required: true },
    senderId: { type: String, index: true, required: true },
    recipientId: { type: String, index: true, required: true },
    text: { type: String, required: true },
    senderName: { type: String, trim: true },
    recipientName: { type: String, trim: true },
    channel: { type: String, enum: ['RETAIL_CHAT', 'SUPPORT_TICKET', 'CORPORATE_SUPPORT', 'SYSTEM'], default: 'RETAIL_CHAT', index: true },
    sourceType: { type: String, trim: true, index: true },
    supportTicketId: { type: String, trim: true, index: true, sparse: true },
    corporateClientId: { type: String, trim: true, index: true, sparse: true },
    orderId: { type: String, trim: true, index: true, sparse: true },
    metadata: { type: mongoose.Schema.Types.Mixed },

    // ✅ Ensure status enum + default
    status: {
      type: String,
      enum: ['sent', 'delivered', 'read'],
      default: 'sent',
    },
    // NOTE:
    // We keep timestamps below. That already creates `createdAt` & `updatedAt`.
    // No need to define createdAt again here to avoid conflicts.
  },
  {
    timestamps: true,              // keeps createdAt/updatedAt
    collection: 'documents',       // your messages live in this collection
  }
);

// --- Indexes ---
// ✅ As requested (ordering newest/oldest by chat and fast unread counts per user)
MessageSchema.index({ chatId: 1, createdAt: 1 });
MessageSchema.index({ recipientId: 1, chatId: 1, status: 1 });

// (Optional) Keep helpful legacy indexes if you had them before — harmless and may help:
MessageSchema.index({ recipientId: 1, status: 1, createdAt: -1 });
MessageSchema.index({ senderId: 1, createdAt: -1 });
MessageSchema.index({ supportTicketId: 1, createdAt: 1 });
MessageSchema.index({ channel: 1, createdAt: -1 });

module.exports = mongoose.model('Message', MessageSchema);
