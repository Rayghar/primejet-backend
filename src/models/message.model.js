const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  chatId: { type: String, required: true, index: true },   // order UUID
  senderId: { type: String, required: true, index: true },
  recipientId: { type: String, required: false, default: null, index: true },
  text: { type: String, required: true, maxlength: 2000, trim: true },
  status: { type: String, enum: ['sent','delivered','read'], default: 'sent' },
}, { timestamps: true });

schema.index({ chatId: 1, createdAt: 1 });

module.exports = mongoose.model('Message', schema);
