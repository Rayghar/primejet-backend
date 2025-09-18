// File: src/models/message.model.js
const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  chatId: { type: String, index: true, required: true },
  senderId: { type: String, index: true, required: true },
  recipientId: { type: String, index: true, required: true },
  text: { type: String, required: true },
  status: { type: String, enum: ['sent', 'delivered', 'read'], default: 'sent' },
}, { timestamps: true, collection: 'documents' }); // <--- important if your data lives there

// helpful indexes
MessageSchema.index({ chatId: 1, createdAt: 1 });
MessageSchema.index({ recipientId: 1, status: 1, createdAt: -1 });
MessageSchema.index({ senderId: 1, createdAt: -1 });

module.exports = mongoose.model('Message', MessageSchema);
