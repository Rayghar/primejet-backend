// src/models/message.model.js
const mongoose = require('mongoose');
const { toJSON } = require('../plugins/toJSON.plugin.js');

const messageSchema = mongoose.Schema(
  {
    chatId: { // This will typically be the orderId to group messages
      type: String,
      required: true,
      index: true,
    },
    senderId: { // The internal app ID of the sender
      type: String,
      required: true,
    },
    recipientId: { // The internal app ID of the recipient
      type: String,
      required: true,
    },
    text: {
      type: String,
      required: true,
      trim: true,
    },
  },
  {
    timestamps: true, // Automatically adds createdAt and updatedAt
  }
);

messageSchema.plugin(toJSON);

const Message = mongoose.model('Message', messageSchema);

module.exports = Message;