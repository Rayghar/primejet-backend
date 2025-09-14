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
  // BEFORE: This was causing a CastError because senderId is a UUID, not an ObjectId.
  // const sender = await User.findById(senderId).lean();
  
  // ✅ AFTER: Query by the custom 'id' field.
  const sender = await User.findOne({ id: senderId }).lean();

  // BEFORE: This was causing a CastError because orderId is a UUID, not an ObjectId.
  // const order = await Order.findById(orderId).lean();

  // ✅ AFTER: Query by the custom 'id' field.
  const order = await Order.findOne({ id: orderId }).lean();

  if (!sender || !order) {
    throw new HttpError(404, 'User or Order not found.');
  }

  // NOTE: Your authorization logic here is incorrect because of the change to lean().
  // Mongoose documents have an .equals() method, but plain JavaScript objects do not.
  // You must compare the string representations of the ObjectIds.
  const isSenderCustomer = sender._id.toString() === order.customer.toString();
  const isSenderDriver = order.driver && (sender._id.toString() === order.driver.toString());

  if (!isSenderCustomer && !isSenderDriver) {
    throw new HttpError(403, 'You are not authorized to chat for this order.');
  }

  logger.info(`[CHAT_SERVICE] Auth successful for user ${senderId} on order ${orderId}.`);
  
  // ✅ FIX: The chatId should be the UUID `id`, not the `_id`, to be consistent.
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