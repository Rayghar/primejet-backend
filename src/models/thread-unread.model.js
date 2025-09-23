// models/thread-unread.model.js
const mongoose = require('mongoose');

const ThreadUnreadSchema = new mongoose.Schema(
  {
    chatId: { type: String, index: true, required: true },
    userId: { type: String, index: true, required: true },
    unread: { type: Number, default: 0 },
  },
  { timestamps: true }
);

ThreadUnreadSchema.index({ chatId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('ThreadUnread', ThreadUnreadSchema);
