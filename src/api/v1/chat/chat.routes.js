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

// Get the caller's chat threads
router.get('/threads', auth(), chatController.getMyThreads);

// EXISTING history route (keep this so nothing breaks):
// GET /api/v1/chat/:chatId/history
router.get(
  '/:chatId/history',
  auth(),
  validate(chatValidation.getChatHistorySchema),
  chatController.getChatHistory
);

// NEW alias route to fix frontend calls like
// GET /api/v1/chat/history/:chatId?limit=50
router.get(
  '/history/:chatId',
  auth(), // (no extra validation necessary for a quick alias)
  chatController.getHistory // new controller handler below
);

module.exports = router;
