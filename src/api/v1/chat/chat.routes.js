// src/api/v1/chat/chat.routes.js
const express = require('express');
const auth = require('../../../middleware/auth.middleware');
const validate = require('../../../middleware/validate.middleware');
const chatValidation = require('./chat.validation');
const chatController = require('./chat.controller');

const router = express.Router();

// Route for the client to check if it's authorized before connecting to the socket
router.post(
  '/initiate',
  auth(), // Protects with your existing JWT auth
  validate(chatValidation.initiateChatSchema),
  chatController.initiateChat
);

router.get('/threads', auth(), chatController.getMyThreads);


// Route for the client to fetch historical messages when opening the chat screen
router.get(
  '/:chatId/history',
  auth(),
  validate(chatValidation.getChatHistorySchema),
  chatController.getChatHistory
);

module.exports = router;