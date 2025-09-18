// api/v1/chat/chat.controller.js
const chatService = require('./chat.service');

exports.getHistory = async (req, res, next) => {
  try {
    const { chatId } = req.params;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const page = Math.max(Number(req.query.page) || 1, 1);

    const messages = await chatService.getChatHistory(chatId, limit, page);
    res.json(messages);
  } catch (e) {
    next(e);
  }
};

exports.postMessage = async (req, res, next) => {
  try {
    const { chatId } = req.params;
    const { text } = req.body;
    const senderId = req.user.id;
    const saved = await chatService.saveChatMessage({
      chatId,
      senderId,
      recipientId: null, // server will infer on socket flow; REST keeps it null
      text,
    });
    res.status(201).json(saved);
  } catch (e) {
    next(e);
  }
};

exports.getMyThreads = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const threads = await chatService.getThreadsForUser(userId, limit);
    res.json({ threads });
  } catch (e) {
    next(e);
  }
};
