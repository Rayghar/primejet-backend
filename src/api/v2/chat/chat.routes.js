// File: src/api/v1/chat/chat.routes.js
const express = require('express');
const auth = require('../../../middleware/auth.middleware');
const validate = require('../../../middleware/validate.middleware');
const chatValidation = require('./chat.validation');
const chatController = require('./chat.controller');

const router = express.Router();

/**
 * @route   POST /api/v1/chat/initiate
 * @desc    Authorizes a user for a chat session before they connect to the socket room.
 * @access  Private
 */
router.post(
  '/initiate',
  auth(),
  validate(chatValidation.initiateChatSchema),
  chatController.initiateChat
);

/**
 * @route   GET /api/v1/chat/threads
 * @desc    Get the calling user's chat threads, enriched with recipient and order data.
 * @access  Private
 */
// ✅ FIX: This route is changed from '/my-threads' to '/threads' to match the client's API call and fix the 404 error.
router.get(
  '/threads',
  auth(),
  chatController.getMyThreads
);

/**
 * @route   GET /api/v1/chat/:chatId/history
 * @desc    Get the message history for a specific chat room (order).
 * @access  Private
 */
// ✅ FIX: Re-added the crucial history route needed by the chat screen to load messages.
router.get(
  '/:chatId/history',
  auth(),
  validate(chatValidation.getChatHistorySchema),
  chatController.getHistory
);

module.exports = router;