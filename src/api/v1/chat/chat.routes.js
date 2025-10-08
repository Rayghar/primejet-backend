// api/v1/chat/chat.routes.js
const express = require('express');
const auth = require('../../../middleware/auth.middleware');
const validate = require('../../../middleware/validate.middleware');
const chatValidation = require('./chat.validation');
const chatController = require('./chat.controller');

const router = express.Router();

// Authorize a user for a chat session before they connect to the socket room.
router.post(
  '/initiate',
  auth(),
  validate(chatValidation.initiateChatSchema),
  chatController.initiateChat
);

// Get the calling user's chat threads, enriched with recipient and order data.
router.get(
  '/threads', 
  auth(),
  chatController.getMyThreads
);

// Get the message history for a specific chat room (order).
// This is the single endpoint used by both customer and driver apps.
router.get(
  '/:chatId/history',
  auth(),
  validate(chatValidation.getChatHistorySchema),
  chatController.getHistory // Updated to use the correct, unified controller
);

module.exports = router;