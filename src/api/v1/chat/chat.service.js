// backend/api/v1/chat/chat.service.js

const User = require('../../../models/user.model');
const Order = require('../../../models/order.model');
const Message = require('../../../models/message.model');
const HttpError = require('../../../utils/HttpError');
// ✅ FIX: Import the correct, robust fcm.service.js.
// The path is relative to the current file's location.
const { notifyMessage } = require('../fcm/fcm.service');

// ---------------------------------------------------------------------------
// Existing functions (kept as-is)
// ---------------------------------------------------------------------------

const initiateChatSession = async (orderId, senderId) => {
  const sender = await User.findOne({ id: senderId });
  const order = await Order.findOne({ id: orderId })
    .populate('customer')
    .populate('driver');

  if (!sender || !order) throw new HttpError(404, 'User or Order not found.');

  const isCustomer = order.customer && sender.id === order.customer.id;
  const isDriver = order.driver && sender.id === order.driver.id;
  if (!isCustomer && !isDriver) {
    throw new HttpError(403, 'You are not authorized to chat for this order.');
  }

  return { message: 'Authorization successful.', chatId: order.id };
};

const verifyParticipation = async (orderId, userId) => {
  const order = await Order.findOne({ id: orderId })
    .populate('customer')
    .populate('driver');
  if (!order) return false;
  return !!(
    (order.customer && order.customer.id === userId) ||
    (order.driver && order.driver.id === userId)
  );
};

const getMessageHistory = async (chatId, before, limit = 50) => {
  const cursor = before ? new Date(before) : new Date();
  const items = await Message.find({ chatId, createdAt: { $lt: cursor } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  // newest last for UI
  return items.reverse();
};

/**
 * Save a chat message and trigger a notification for the known recipient.
 */
async function saveChatMessage({ chatId, senderId, recipientId, text }) {
  const msg = await Message.create({
    chatId,
    senderId,
    recipientId: recipientId || null,
    text: String(text || '').slice(0, 2000).trim(),
    status: 'sent',
  });

  // Fire push notification for the recipient (if we know them)
  if (recipientId) {
      const sender = await User.findOne({ id: senderId }).select('name').lean();
      const senderName = sender ? sender.name : 'Someone';
      
      // ✅ FIX: Call the correct notifyMessage function from fcm.service.js
      // This ensures sound and high-priority display.
      await notifyMessage({
          recipientId: recipientId,
          title: `New Message from ${senderName}`,
          body: msg.text,
          data: {
              type: 'new_message',
              orderId: msg.chatId,
              senderId: msg.senderId,
              screen: 'chat_screen' // For frontend deep linking
          }
      });
  }

  // Normalized payload for clients
  return {
    _id: msg._id,
    id: msg._id,
    chatId: msg.chatId,
    senderId: msg.senderId,
    recipientId: msg.recipientId,
    text: msg.text,
    status: msg.status,
    createdAt: msg.createdAt,
    updatedAt: msg.updatedAt,
  };
}

/**
 * Threads list by last message per chat for a user.
 */
async function getThreadsForUser(userId, limit = 50) {
  const pipeline = [
    { $match: { $or: [{ senderId: userId }, { recipientId: userId }] } },
    { $sort: { createdAt: -1 } },
    { $group: { _id: '$chatId', lastMessage: { $first: '$$ROOT' } } },
    { $project: { _id: 0, chatId: '$_id', lastMessage: 1 } },
    { $limit: Number(limit) },
  ];

  const threads = await Message.aggregate(pipeline).exec();

  const ids = threads.map((t) => t.chatId);
  const orders = await Order.find({ id: { $in: ids } }).lean();
  const byId = Object.fromEntries(orders.map((o) => [o.id, o]));
  return threads.map((t) => ({
    ...t,
    recipientName: byId[t.chatId]?.recipientName ?? 'Customer',
    recipientPhone: byId[t.chatId]?.recipientPhone ?? null,
  }));
}

// ---------------------------------------------------------------------------
// NEW HELPERS for Socket.IO manager integration
// ---------------------------------------------------------------------------

async function createMessage({ chatId, senderId, recipientId, text }) {
  const doc = await Message.create({
    chatId,
    senderId,
    recipientId,
    text: String(text || '').slice(0, 2000).trim(),
    status: 'sent',
    createdAt: new Date(),
  });
  return doc;
}

async function countUnreadForUserInChat(userId, chatId) {
  return Message.countDocuments({
    chatId,
    recipientId: userId,
    status: { $in: ['sent', 'delivered'] },
  });
}

async function markChatRead(userId, chatId) {
  await Message.updateMany(
    { chatId, recipientId: userId, status: { $in: ['sent', 'delivered'] } },
    { $set: { status: 'read' } }
  );
}

async function setDeliveredIfSent(messageId) {
  await Message.updateOne(
    { _id: messageId, status: 'sent' },
    { $set: { status: 'delivered' } }
  );
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  // existing
  initiateChatSession,
  verifyParticipation,
  saveChatMessage,
  getMessageHistory,
  getThreadsForUser,

  // new helpers for Socket.IO integration
  createMessage,
  countUnreadForUserInChat,
  markChatRead,
  setDeliveredIfSent,
};