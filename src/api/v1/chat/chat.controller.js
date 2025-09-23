const chatService = require('./chat.service');
// NOTE: Path mirrors how you import middleware in routes (../../../...)
const Message = require('../../../models/message.model'); // adjust if your model lives elsewhere

const initiateChat = async (req, res, next) => {
  try {
    const { orderId } = req.body;

    // Use req.user.id (auth middleware sets this)
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
    // Optional: participant check can go here via chatService if desired
    const messages = await chatService.getMessageHistory(chatId);
    res.status(200).json(messages);
  } catch (error) {
    next(error);
  }
};

const getMyThreads = async (req, res, next) => {
  try {
    const me = req.user.id; // set by your auth middleware
    const { limit = 50 } = req.query;
    const threads = await chatService.getThreadsForUser(me, limit);
    return res.json({ threads });
  } catch (err) {
    next(err);
  }
};

/**
 * NEW: Direct "history/:chatId" handler to match frontend calls:
 * GET /api/v1/chat/history/:chatId?limit=50
 * Returns messages sorted oldest -> newest, with an upper bound on limit.
 */
const getHistory = async (req, res, next) => {
  try {
    const { chatId } = req.params;
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    if (!chatId) return res.status(400).json({ error: 'chatId required' });

    // If you want a strict participant check, you can add it here using chatService.

    const items = await Message.find({ chatId })
      .sort({ createdAt: 1 }) // oldest -> newest
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
  // NEW export
  getHistory,
};
