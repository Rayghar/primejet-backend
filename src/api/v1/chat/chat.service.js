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
  // Find the sender (User) by their UUID 'id'
  const sender = await User.findOne({ id: senderId });

  // Find the Order by its UUID 'id' and populate its virtual customer/driver fields
  const order = await Order.findOne({ id: orderId })
    .populate('customer')
    .populate('driver');

  if (!sender || !order) {
    throw new HttpError(404, 'User or Order not found.');
  }

  // Perform authorization by comparing the UUIDs of the sender and the order's participants
  const isSenderCustomer = order.customer && sender.id === order.customer.id;
  const isSenderDriver = order.driver && sender.id === order.driver.id;

  if (!isSenderCustomer && !isSenderDriver) {
    throw new HttpError(403, 'You are not authorized to chat for this order.');
  }

  logger.info(`[CHAT_SERVICE] Auth successful for user ${senderId} on order ${orderId}.`);
  
  // Return the order's UUID as the chatId
  return { message: 'Authorization successful.', chatId: order.id }; 
};

/**
 * Saves a new chat message to the MongoDB database.
 */
const saveChatMessage = async (messagePayload) => {
  // ✅ FIX: When saving, ensure the chatId is the UUID from the order.
  // The payload from the socket manager should already contain the correct order UUID as chatId.
  const message = await Message.create(messagePayload);
  return message;
};

/**
 * Fetches the message history for a specific chat room (order).
 */
const getMessageHistory = async (chatId) => {
  // ✅ FIX: Query messages using the order's UUID.
  const messages = await Message.find({ chatId: chatId }).sort({ createdAt: 1 }).lean();
  return messages;
};

module.exports = {
  initiateChatSession,
  saveChatMessage,
  getMessageHistory,
};