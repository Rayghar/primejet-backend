// backend/api/v1/chat/chat.service.js

const User = require('../../../models/user.model');
const Order = require('../../../models/order.model');
const Message = require('../../../models/message.model');
const Run = require('../../../models/run.model'); // Import Run model for context enrichment
const HttpError = require('../../../utils/HttpError');
const ThreadUnread = require('../../../models/thread-unread.model'); // Import the unread model

/**
 * Verifies a user is a participant in an order chat and returns authorization.
 */
const initiateChatSession = async (orderId, senderId) => {
  const order = await Order.findOne({ id: orderId }).lean();
  if (!order) {
    throw new HttpError(404, 'Order not found.');
  }

  const isParticipant = senderId === order.customerId || senderId === order.driverId;
  if (!isParticipant) {
    throw new HttpError(403, 'You are not authorized to chat for this order.');
  }

  const recipientId = senderId === order.customerId ? order.driverId : order.customerId;
  return { message: 'Authorization successful.', chatId: order.id, recipientId };
};

/**
 * Fetches message history for a given chat, sorted oldest to newest.
 */
const getMessageHistory = async (chatId, limit = 50) => {
  return Message.find({ chatId })
    .sort({ createdAt: 1 }) // oldest -> newest
    .limit(limit)
    .lean();
};

/**
 * Fetches all chat threads for a user, enriched with contextual data.
 * This is the single, efficient query for the message list screen.
 */
async function getThreadsForUser(userId, limit = 50) {
  // Find all unique chatIds the user is a part of.
  const userChats = await Message.distinct('chatId', {
    $or: [{ senderId: userId }, { recipientId: userId }],
  });

  const threads = await Promise.all(
    userChats.map(async (chatId) => {
      const [lastMessage, order] = await Promise.all([
        Message.findOne({ chatId }).sort({ createdAt: -1 }).lean(),
        Order.findOne({ id: chatId }).populate('customer', 'id name phone').populate('driver', 'id name phone').lean(),
      ]);

      if (!order || !lastMessage) return null;

      // Use ThreadUnread for unread count
      const unreadDoc = await ThreadUnread.findOne({ chatId, userId });
      const unreadCount = unreadDoc?.unread ?? 0;

      const recipient = (order.customerId === userId) ? order.driver : order.customer;
      
      let stopNumber = null;
      if (order.driverId === userId) {
        const run = await Run.findOne({ 'stops.orderId': order.id }, { 'stops.$': 1 }).lean();
        if (run && run.stops.length > 0) {
          stopNumber = run.stops[0].sequence;
        }
      }

      return {
        chatId: chatId,
        recipientId: recipient?.id,
        recipientName: recipient?.name,
        recipientPhoneNumber: recipient?.phone,
        orderStatus: order.status,
        stopNumber: stopNumber,
        unreadCount: unreadCount,
        lastMessage: lastMessage,
      };
    })
  );
  
  // Filter out nulls and sort by the most recent message
  const validThreads = threads.filter(t => t !== null);
  validThreads.sort((a, b) => b.lastMessage.createdAt.getTime() - a.lastMessage.createdAt.getTime());
  
  return validThreads.slice(0, limit);
}


// --- Database Helper Functions for Socket.IO ---

/**
 * Creates and saves a new message document.
 */
async function createMessage({ chatId, senderId, recipientId, text }) {
  const doc = await Message.create({
    chatId,
    senderId,
    recipientId,
    text: String(text || '').slice(0, 2000).trim(),
  });

  // Increment unread count for recipient using ThreadUnread
  await ThreadUnread.findOneAndUpdate(
    { chatId, userId: recipientId },
    { $inc: { unread: 1 } },
    { upsert: true }
  );

  return doc.toObject(); // Return a plain JS object
}

/**
 * Marks all messages in a chat as 'read' for a specific user.
 */
async function markChatRead(userId, chatId) {
  const updateResult = await Message.updateMany(
    { chatId, recipientId: userId, status: { $in: ['sent', 'delivered'] } },
    { $set: { status: 'read' } }
  );

  // Reset unread count
  await ThreadUnread.updateOne(
    { chatId, userId },
    { $set: { unread: 0 } }
  );

  return updateResult;
}

/**
 * Atomically updates a message status from 'sent' to 'delivered'.
 */
async function setDeliveredIfSent(messageId) {
  return Message.updateOne(
    { _id: messageId, status: 'sent' },
    { $set: { status: 'delivered' } }
  );
}

module.exports = {
  initiateChatSession,
  getMessageHistory,
  getThreadsForUser,
  createMessage,
  markChatRead,
  setDeliveredIfSent,
};