const User = require('../../../models/user.model');
const Order = require('../../../models/order.model');
const Message = require('../../../models/message.model');
const HttpError = require('../../../utils/HttpError');

const initiateChatSession = async (orderId, senderId) => {
  const sender = await User.findOne({ id: senderId });
  const order = await Order.findOne({ id: orderId }).populate('customer').populate('driver');
  if (!sender || !order) throw new HttpError(404, 'User or Order not found.');

  const isCustomer = order.customer && sender.id === order.customer.id;
  const isDriver   = order.driver   && sender.id === order.driver.id;
  if (!isCustomer && !isDriver) throw new HttpError(403, 'You are not authorized to chat for this order.');

  return { message: 'Authorization successful.', chatId: order.id };
};

const verifyParticipation = async (orderId, userId) => {
  const order = await Order.findOne({ id: orderId }).populate('customer').populate('driver');
  if (!order) return false;
  return !!(
    (order.customer && order.customer.id === userId) ||
    (order.driver && order.driver.id === userId)
  );
};

const saveChatMessage = async (payload) => Message.create(payload);

const getMessageHistory = async (chatId, before, limit = 50) => {
  const cursor = before ? new Date(before) : new Date();
  const items = await Message
    .find({ chatId, createdAt: { $lt: cursor } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  return items.reverse(); // newest last for UI
};

module.exports = {
  initiateChatSession,
  verifyParticipation,
  saveChatMessage,
  getMessageHistory,
};
