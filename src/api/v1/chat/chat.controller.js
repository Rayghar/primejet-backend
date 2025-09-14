// src/api/v1/chat/chat.controller.js
const chatService = require('./chat.service');

const initiateChat = async (req, res, next) => {
  try {
    const { orderId } = req.body;
    const senderId = req.user.sub; // ID from JWT
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

module.exports = {
  initiateChat,
  getChatHistory,
};