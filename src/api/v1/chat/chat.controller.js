// api/v1/chat/chat.controller.js
const chatService = require('./chat.service');
const HttpError = require('../../../utils/HttpError');

const initiateChat = async (req, res, next) => {
  try {
    const { orderId } = req.body;
    const senderId = req.user.id;
    const response = await chatService.initiateChatSession(orderId, senderId);
    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
};

const getMyThreads = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const threads = await chatService.getThreadsForUser(userId);
    res.status(200).json(threads); // The service now returns the fully enriched model
  } catch (err) {
    next(err);
  }
};

const getHistory = async (req, res, next) => {
  try {
    const { chatId } = req.params;
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);

    if (!chatId) {
      throw new HttpError(400, 'chatId is required');
    }
    
    // The service handles fetching messages sorted oldest to newest
    const messages = await chatService.getMessageHistory(chatId, limit);
    res.status(200).json(messages);
  } catch (e) {
    next(e);
  }
};

module.exports = {
  initiateChat,
  getMyThreads,
  getHistory,
};