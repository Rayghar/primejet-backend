// src/api/v1/chat/chat.controller.js
const chatService = require('./chat.service');

const initiateChat = async (req, res, next) => {
  try {
    const { orderId } = req.body;
    
    // BEFORE: This was incorrect, causing the crash.
    // const senderId = req.user.sub; 
    
    // ✅ AFTER: Use `req.user.id`, which is correctly attached by your auth middleware.
    const senderId = req.user.id; 

    const response = await chatService.initiateChatSession(orderId, senderId);
    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
};

const getChatHistory = async (req, res, next) => {
  try {
    const { chatId } = req.params;
    // Optional: Add a check here to ensure req.user.sub is a participant in this chat
    const messages = await chatService.getMessageHistory(chatId);
    res.status(200).json(messages);
  } catch (error) {
    next(error);
  }
};

const getMyThreads = async (req, res, next) => {
  try {
    const me = req.user.id;            // set by your auth middleware
    const { limit = 50 } = req.query;
    const threads = await chatService.getThreadsForUser(me, limit);
    return res.json({ threads });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  initiateChat,
  getChatHistory,
  getMyThreads,
};