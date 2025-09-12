// File: functions/chat/src/api/v1/chat/chat.controller.js

const admin = require('firebase-admin');
const chatService = require('./chat.service');
const catchAsync = require('../../../utils/catchAsync'); // ✅ ADDED: This was the missing import

const initiateChat = catchAsync(async (req, res) => {
  const { orderId, recipientId } = req.body;
  const senderId = req.user.id; // This is the internal app ID from your JWT
  const chatSession = await chatService.initiateChatSession(orderId, senderId, recipientId);
  res.status(201).json(chatSession);
});

const getMyThreads = catchAsync(async (req, res) => {
  // Pass the internal app ID to the service. The service will handle fetching the firebaseUid.
  const userId = req.user.id;
  const threads = await chatService.getMyThreads(userId);
  res.status(200).json(threads);
});

const createFirebaseToken = catchAsync(async (req, res) => {
  const appUserId = req.user.id; 
  const firebaseToken = await admin.auth().createCustomToken(appUserId);
  res.status(200).json({ firebaseToken });
});

module.exports = {
  initiateChat,
  getMyThreads,
  createFirebaseToken,
};