// models/notification.model.js
const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema(
  {
    userId: { type: String, index: true, required: true },         // UUID of the recipient
    type: { type: String, default: 'message' },                    // message | system | etc
    title: { type: String, default: '' },
    body:  { type: String, default: '' },
    data:  { type: Object, default: {} },                          // { chatId, messageId, senderId, ... }
    isRead: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Notification', NotificationSchema);
