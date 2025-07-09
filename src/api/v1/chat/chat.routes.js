// src/api/v1/chat/chat.routes.js
const express = require('express');
const chatController = require('./chat.controller'); // Path to co-located controller
const authMiddleware = require('../../../middleware/auth.middleware'); // Path to global auth middleware
const validate = require('../../../middleware/validate.middleware'); // Path to global validate middleware
const {
  initiateChatSchema,
} = require('./chat.validation'); // Path to co-located validation schemas

const router = express.Router();

console.log('[CHAT_ROUTES] Registering chat routes...');

// All routes in this file are for chat functionalities.
// They will be mounted under a base path like /api/v1/chat in app.js.

router.post(
  '/initiate',
  authMiddleware(), // Requires any authenticated user to initiate a chat
  validate(initiateChatSchema), // Validate request body (orderId, recipientId)
  chatController.initiateChat
);

console.log('[CHAT_ROUTES] Registering chat routes...');

router.get('/my-threads', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    console.log(`[CHAT] Fetching chat threads for userId: ${userId}`);
    const threads = []; // Mock or query database
    res.status(200).json(threads);
  } catch (error) {
    console.error(`[CHAT] Error fetching chat threads: ${error}`);
    res.status(500).json({ error: 'Server error' });
  }
});

console.log('[CHAT_ROUTES] Chat routes registered.');
// You might add other chat-related routes here in the future, e.g.,
// router.get('/:chatId/messages', authMiddleware(), chatController.getChatMessages);
// router.post('/:chatId/messages', authMiddleware(), chatController.sendChatMessage);


module.exports = router;