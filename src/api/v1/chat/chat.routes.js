const express = require('express');
const auth = require('../../../middleware/auth.middleware');
const validate = require('../../../middleware/validate.middleware');
const chatValidation = require('./chat.validation');
const chatController = require('./chat.controller');

const router = express.Router();

router.post(
  '/initiate',
  auth(),
  validate(chatValidation.initiateChatSchema),
  chatController.initiateChat
);

router.get('/threads', auth(), chatController.getMyThreads);
router.post('/message', auth(), chatController.sendMessage);

router.get(
  '/:chatId/history',
  auth(),
  validate(chatValidation.getChatHistorySchema),
  chatController.getChatHistory
);

router.get('/history/:chatId', auth(), chatController.getHistory);

module.exports = router;
