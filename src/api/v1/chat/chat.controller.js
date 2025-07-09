// src/api/v1/chat/chat.controller.js
const chatService = require('./chat.service'); // Path to the new co-located chat service
const HttpError = require('../../../utils/HttpError'); // Path to global HttpError utility
// const { logger } = require('../../../config/logger.config.js'); // Optional: for structured logging

const initiateChat = async (req, res, next) => {
  try {
    // req.body (orderId, recipientId) is validated by Joi schema in chat.routes.js
    const { orderId, recipientId } = req.body;
    const senderId = req.user.id; // Sender is the authenticated user

    if (senderId === recipientId) {
      return next(new HttpError(400, 'Sender and recipient cannot be the same user.'));
    }

    const chatDetails = await chatService.initiateChatSession(
      orderId,
      senderId,
      recipientId
    );

    // The service (and previously firebaseService) returned { chatId }
    res.status(201).json(chatDetails);
  } catch (error) {
    // logger.error(`[CHAT_CONTROLLER] Error initiating chat for user ${req.user.id} with recipient ${req.body.recipientId}:`, error);
    next(error);
  }
};

const getMyThreads = async (req, res, next) => {
  try {
    const threads = await chatService.getMyThreads(req.user.id);
    res.status(200).json(threads);
  } catch (error) {
    next(error);
  }
};


module.exports = {
  initiateChat,
  getMyThreads,
};