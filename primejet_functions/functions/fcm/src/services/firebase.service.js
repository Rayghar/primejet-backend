// src/services/firebase.service.js

const admin = require('firebase-admin');
const HttpError = require('../utils/HttpError');
const { logger } = require('../config/logger.config.js');

/**
 * Gets the initialized Firestore instance.
 * This relies on admin.initializeApp() being called once in the application's entry point (index.js).
 * @returns {FirebaseFirestore.Firestore} The Firestore database instance.
 */
const getFirestore = () => {
  try {
    // This will work because admin.initializeApp() was called in index.js
    return admin.firestore();
  } catch (error) {
    logger.error('Failed to get Firestore instance. Was admin.initializeApp() called?', error);
    throw new HttpError(503, 'Firebase (Firestore) has not been initialized correctly.');
  }
};

/**
 * Finds an existing chat thread or creates a new one in Firestore.
 * @param {string} orderId The ID of the order context.
 * @param {string} senderId The ID of the user starting the chat.
 * @param {string} recipientId The ID of the other user in the chat.
 * @returns {Promise<{chatId: string}>} An object containing the chat thread ID.
 */
const initiateChat = async (orderId, senderId, recipientId, senderFirebaseUid, recipientFirebaseUid) => {
  const db = getFirestore();
  try {
    const participants = [senderId, recipientId].sort();
    // ✅ NEW: Create an array of the Firebase UIDs
    const participantUids = [senderFirebaseUid, recipientFirebaseUid];

    const chatId = `${orderId}_${participants[0]}_${participants[1]}`;
    const chatRef = db.collection('chats').doc(chatId);
    const chatDoc = await chatRef.get();

    if (!chatDoc.exists) {
      await chatRef.set({
        orderId,
        participants: [senderId, recipientId], // Keep your internal IDs
        participantIds: participants,
        participantUids: participantUids, // ✅ ADD THIS NEW FIELD
        createdAt: new Date(),
        lastMessage: null,
        lastMessageTimestamp: null,
        updatedAt: new Date(),
      });
      logger.info(`[FIREBASE_SERVICE] Chat initiated with ID: ${chatId} for order ${orderId}`);
    } else {
      logger.info(`[FIREBASE_SERVICE] Chat already exists with ID: ${chatId} for order ${orderId}`);
      await chatRef.update({ updatedAt: new Date() });
    }
    return { chatId };
  } catch (error) {
    logger.error(`[FIREBASE_SERVICE] Error in initiateChat for order ${orderId}:`, error);
    throw new HttpError(500, `Failed to initiate chat: ${error.message}`);
  }
};

/**
 * Fetches all chat threads for a given user.
 * @param {string} userId The ID of the user.
 * @returns {Promise<Array<Object>>} A list of chat thread documents.
 */
const fetchUserChatThreads = async (userId) => {
  const db = getFirestore();
  const snapshot = await db.collection('chats')
    .where('participantIds', 'array-contains', userId)
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

// We only export the functions that are actually used by the chat service.
module.exports = {
  initiateChat,
  fetchUserChatThreads,
};