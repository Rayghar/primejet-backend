const express = require('express');
const chatController = require('./chat.controller');
const authMiddleware = require('../../../middleware/auth.middleware');
const validate = require('../../../middleware/validate.middleware');
const { initiateChatSchema } = require('./chat.validation');

const router = express.Router();

// Route to securely find or create a chat thread for a specific order.
router.post(
  '/initiate',
  (req, _res, next) => {
    req.logger?.info?.('[CHAT_ROUTE] /initiate hit', {
      hasAuth: Boolean(req.headers.authorization),
      contentType: req.headers['content-type'],
      bodyKeys: Object.keys(req.body || {}),
    });
    next();
  },
  authMiddleware,          // ensure this is present
  validateBody(chatSchema),// your Joi validator
  chatController.initiateChat
);

// Route to fetch a list of all chat threads a user is a part of.
router.get(
  '/my-threads',
  authMiddleware(),
  chatController.getMyThreads
);

module.exports = router;

console.log('[CHAT_ROUTES] Chat routes registered.');
// You might add other chat-related routes here in the future, e.g.,
// router.get('/:chatId/messages', authMiddleware(), chatController.getChatMessages);
// router.post('/:chatId/messages', authMiddleware(), chatController.sendChatMessage);


module.exports = router;