// src/api/v1/chat/chat.service.js
const User = require('../../../models/user.model');
const Order = require('../../../models/order.model');
const Message = require('../../../models/message.model');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');

/**
 * Verifies if a user is allowed to join a chat for a specific order.
 */
const initiateChatSession = async (orderId, senderId) => {
  const sender = await User.findById(senderId).lean();
  const order = await Order.findById(orderId).lean();

  if (!sender || !order) {
    throw new HttpError(404, 'User or Order not found.');
  }

  const isSenderCustomer = sender._id.equals(order.customer);
  const isSenderDriver = order.driver && sender._id.equals(order.driver);

  if (!isSenderCustomer && !isSenderDriver) {
    throw new HttpError(403, 'You are not authorized to chat for this order.');
  }

  logger.info(`[CHAT_SERVICE] Auth successful for user ${senderId} on order ${orderId}.`);
  return { message: 'Authorization successful.', chatId: orderId };
};

/**
 * Saves a new chat message to the MongoDB database.
 */
const saveChatMessage = async (messagePayload) => {
  const message = await Message.create(messagePayload);
  return message;
};

/**
 * Fetches the message history for a specific chat room (order).
 */
const getMessageHistory = async (chatId) => {
  const messages = await Message.find({ chatId }).sort({ createdAt: 1 }).lean();
  return messages;
};

module.exports = {
  initiateChatSession,
  saveChatMessage,
  getMessageHistory,
};