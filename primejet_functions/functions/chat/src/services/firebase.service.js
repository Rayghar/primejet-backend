// File: functions/chat/src/services/firebase.service.js
const admin = require('firebase-admin');
const HttpError = require('../utils/HttpError');
const { logger } = require('../config/logger.config.js');

// This file now simply uses the 'admin' object.
// It relies on index.js to call admin.initializeApp() before any request is handled.

const initiateChat = async (orderId, senderId, recipientId, senderFirebaseUid, recipientFirebaseUid) => {
  const db = admin.firestore(); // Get the firestore instance from the initialized admin object
  try {
    const participants = [senderId, recipientId].sort();
    const participantUids = [senderFirebaseUid, recipientFirebaseUid];

    const chatId = `${orderId}_${participants[0]}_${participants[1]}`;
    const chatRef = db.collection('chats').doc(chatId);
    const chatDoc = await chatRef.get();

    if (!chatDoc.exists) {
      await chatRef.set({
        orderId,
        participants: [senderId, recipientId],
        participantIds: participants,
        participantUids: participantUids,
        createdAt: new Date(),
        lastMessage: null,
        lastMessageTimestamp: null,
        updatedAt: new Date(),
      });
      logger.info(`[FIREBASE_SERVICE] Chat initiated with ID: ${chatId}`);
    } else {
      logger.info(`[FIREBASE_SERVICE] Chat already exists with ID: ${chatId}`);
      await chatRef.update({ updatedAt: new Date() });
    }
    return { chatId };
  } catch (error) {
    logger.error(`[FIREBASE_SERVICE] Error in initiateChat for order ${orderId}:`, error);
    throw new HttpError(500, `Failed to initiate chat: ${error.message}`);
  }
};

const fetchUserChatThreads = async (userId) => {
  const db = admin.firestore();
  const snapshot = await db.collection('chats')
    .where('participantUids', 'array-contains', userId) // Using the correct UID field for rules
    .orderBy('lastMessageTimestamp', 'desc')
    .get();

  if (snapshot.empty) {
    return [];
  }

  return snapshot.docs.map(doc => ({
    chatId: doc.id,
    ...doc.data()
  }));
};

module.exports = {
  initiateChat,
  fetchUserChatThreads,
};