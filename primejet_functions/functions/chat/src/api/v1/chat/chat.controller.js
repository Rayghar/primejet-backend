// File: functions/chat/src/api/v1/chat/chat.controller.js

const admin = require('firebase-admin');
const chatService = require('./chat.service');

const initiateChat = async (req, res, next) => {
  try {
    const { orderId, recipientId } = req.body;
    const senderId = req.user.id;
    const chatSession = await chatService.initiateChatSession(orderId, senderId, recipientId);
    res.status(201).json(chatSession);
  } catch (error) {
    next(error); // Pass errors to the central error handler
  }
};

const getMyThreads = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const threads = await chatService.getMyThreads(userId);
    res.status(200).json(threads);
  } catch (error) {
    next(error);
  }
};

const createFirebaseToken = async (req, res, next) => {
  try {
    const appUserId = req.user.id;
    const firebaseToken = await admin.auth().createCustomToken(appUserId);
    res.status(200).json({ firebaseToken });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  initiateChat,
  getMyThreads,
  createFirebaseToken,
};