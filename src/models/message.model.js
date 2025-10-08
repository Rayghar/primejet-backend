// models/message.model.js
const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema(
  {
    chatId: { type: String, index: true, required: true },
    senderId: { type: String, index: true, required: true },
    recipientId: { type: String, index: true, required: true },
    text: { type: String, required: true, trim: true, maxLength: 2000 },
    
    status: {
      type: String,
      enum: ['sent', 'delivered', 'read'],
      default: 'sent',
    },
  },
  {
    timestamps: true,
  }
);

// --- Performance Indexes ---
// For fetching and sorting messages within a chat efficiently.
MessageSchema.index({ chatId: 1, createdAt: 1 });
// For quickly counting unread messages for a user in a chat.
MessageSchema.index({ recipientId: 1, chatId: 1, status: 1 });


module.exports = mongoose.model('Message', MessageSchema);