// src/api/v1/chat/chat.controller.js
const chatService = require('./chat.service'); // Path to the new co-located chat service
const HttpError = require('../../../utils/HttpError'); // Path to global HttpError utility
// const { logger } = require('../../../config/logger.config.js'); // Optional: for structured logging

const initiateChat = async (req, res, next) => {
  try {
    const { orderId, recipientId } = req.body;
    const senderId = req.user.id;

    if (senderId === recipientId) {
      return next(new HttpError(400, 'Sender and recipient cannot be the same user.'));
    }

    const chatDetails = await chatService.initiateChatSession(orderId, senderId, recipientId);
    return res.status(201).json(chatDetails);
  } catch (error) {
    // TEMPORARY: Surface underlying error to the client when DEBUG flag is set
    const status = error.statusCode || error.status || 500;
    const payload = { message: error.message || 'Failed to initiate chat session.' };

    if (process.env.DEBUG_CHAT_ERRORS === '1') {
      payload.name = error.name;
      payload.stack = error.stack;
      // Include minimal request context (non-PII)
      payload.context = {
        senderId: req.user?.id,
        recipientId: req.body?.recipientId,
        orderId: req.body?.orderId,
      };
    }

    return res.status(status).json(payload);
  }
};

const getMyThreads = async (req, res, next) => {
  try {
    const threads = await chatService.getMyThreads(req.user.id);
    res.status(200).json(threads);
  } catch (error) {
    next(error);
  }
};

const createFirebaseToken = catchAsync(async (req, res) => {
  // Get the user's internal app ID from your own JWT
  const appUserId = req.user.id; 

  // Use the Admin SDK to create a custom Firebase token for that ID
  const firebaseToken = await admin.auth().createCustomToken(appUserId);

  // Send the token back to the app
  res.status(200).json({ firebaseToken });
});


module.exports = {
  initiateChat,
  getMyThreads,
  createFirebaseToken,
};