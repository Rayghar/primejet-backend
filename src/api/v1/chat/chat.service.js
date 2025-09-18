// api/v1/chat/chat.service.js
const Message = require('../../models/message.model');
const Order = require('../../models/order.model');

function normalize(msgDoc) {
  if (!msgDoc) return null;
  const m = msgDoc.toObject ? msgDoc.toObject() : msgDoc;
  return {
    _id: m._id,
    id: String(m._id),
    chatId: m.chatId,
    senderId: m.senderId,
    recipientId: m.recipientId ?? null,
    text: m.text,
    status: m.status || 'sent',
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}

exports.saveChatMessage = async ({ chatId, senderId, recipientId, text }) => {
  const created = await Message.create({
    chatId,
    senderId,
    recipientId: recipientId ?? null,
    text,
    status: 'sent',
  });
  return normalize(created);
};

exports.getChatHistory = async (chatId, limit = 50, page = 1) => {
  const docs = await Message.find({ chatId })
    .sort({ createdAt: 1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

  return docs.map(normalize);
};

exports.getThreadsForUser = async (userId, limit = 50) => {
  // last message per chat involving this user
  const rows = await Message.aggregate([
    {
      $match: {
        $or: [{ senderId: userId }, { recipientId: userId }],
      },
    },
    { $sort: { createdAt: 1 } },
    {
      $group: {
        _id: '$chatId',
        last: { $last: '$$ROOT' },
      },
    },
    { $sort: { 'last.createdAt': -1 } },
    { $limit: limit },
  ]);

  const chatIds = rows.map((r) => r._id);
  const orders = await Order.find({ id: { $in: chatIds } })
    .select('id recipientName recipientPhone customerId driverId')
    .lean();

  const byId = Object.fromEntries(orders.map((o) => [o.id, o]));

  const threads = rows.map((r) => ({
    chatId: r._id,
    lastMessage: normalize(r.last),
  }));

  // FIX: proper spread (replaces the broken ".t," line)
  return threads.map((t) => ({
    ...t,
    recipientName: byId[t.chatId]?.recipientName ?? 'Customer',
    recipientPhone: byId[t.chatId]?.recipientPhone ?? null,
  }));
};
