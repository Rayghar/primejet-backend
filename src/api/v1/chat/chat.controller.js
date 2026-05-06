const chatService = require('./chat.service');
const Message = require('../../../models/message.model');
const Order = require('../../../models/order.model');

const initiateChat = async (req, res, next) => {
  try {
    const { orderId } = req.body;
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
    const messages = await chatService.getMessageHistory(chatId);
    res.status(200).json(messages);
  } catch (error) {
    next(error);
  }
};

const getMyThreads = async (req, res, next) => {
  try {
    const me = req.user.id;
    const { limit = 50 } = req.query;
    const threads = await chatService.getThreadsForUser(me, limit);
    return res.json({ threads });
  } catch (err) {
    next(err);
  }
};

const sendMessage = async (req, res, next) => {
  try {
    const { chatId, text, recipientId } = req.body || {};
    if (!chatId) return res.status(400).json({ error: 'chatId required' });
    if (!String(text || '').trim()) return res.status(400).json({ error: 'message text required' });

    let targetRecipientId = recipientId;

    // Support/Admin fallback: when the UI replies from a thread/order and does not
    // know the recipientId, infer the customer from the order matching chatId.
    if (!targetRecipientId) {
      const order = await Order.findOne({ id: chatId }).lean();
      targetRecipientId = order?.customerId || order?.userId || order?.driverId || null;
    }

    if (!targetRecipientId) return res.status(400).json({ error: 'recipientId required' });

    const message = await chatService.saveChatMessage({
      chatId,
      senderId: req.user.id,
      recipientId: targetRecipientId,
      text,
    });

    return res.status(201).json(message);
  } catch (error) {
    next(error);
  }
};

/**
 * Direct alias route handler to match frontend calls:
 * GET /api/v1/chat/history/:chatId?limit=50
 */
const getHistory = async (req, res, next) => {
  try {
    const { chatId } = req.params;
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    if (!chatId) return res.status(400).json({ error: 'chatId required' });

    const items = await Message.find({ chatId })
      .sort({ createdAt: 1 })
      .limit(limit)
      .lean();

    return res.json(items);
  } catch (e) {
    next(e);
  }
};

module.exports = {
  initiateChat,
  getChatHistory,
  getMyThreads,
  sendMessage,
  getHistory,
};
