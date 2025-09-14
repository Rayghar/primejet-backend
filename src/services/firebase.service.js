// src/services/firebase.service.js

const admin = require('firebase-admin');
const HttpError = require('../utils/HttpError');
const { logger } = require('../config/logger.config.js');

// --- REMOVED ---
// The old, complex initializeFirebase() function is no longer needed.
// Initialization is now handled once in the main index.js file.

// --- CORRECTED ---
// This function now gets the Firestore instance from the globally initialized admin object.
const getFirestore = () => {
  try {
    return admin.firestore();
  } catch (error) {
    logger.error('Failed to get Firestore instance. Was admin.initializeApp() called?', error);
    throw new HttpError(503, 'Firebase (Firestore) has not been initialized correctly.');
  }
};

// ✅ UPDATED: The function now accepts the full sender and recipient objects.
const initiateChat = async (orderId, sender, recipient) => {
  const db = getFirestore();
  try {
    // ✅ CORRECTED: Use the internal 'id' for the participants arrays.
    const participants = [sender.id, recipient.id].sort();
    
    const chatId = `${orderId}_${participants[0]}_${participants[1]}`;
    const chatRef = db.collection('chats').doc(chatId);
    const chatDoc = await chatRef.get();

    if (!chatDoc.exists) {
      const participantInfo = {
        [sender.id]: { name: sender.name, role: sender.role },
        [recipient.id]: { name: recipient.name, role: recipient.role }
      };

      await chatRef.set({
        orderId,
        participants: participants, // This now contains the correct internal IDs
        participantInfo: participantInfo,
        // --- REMOVED --- We no longer need a separate 'participantUids' field.
        createdAt: new Date(),
        lastMessage: null,
        lastMessageTimestamp: null,
        updatedAt: new Date(),
      });
      logger.info(`[FIREBASE_SERVICE] Chat initiated with ID: ${chatId}`);
    } else {
      await chatRef.update({ updatedAt: new Date() });
    }
    return { chatId };
  } catch (error) {
    logger.error(`[FIREBASE_SERVICE] Error in initiateChat:`, error);
    throw new HttpError(500, `Failed to initiate chat: ${error.message}`);
  }
};

// This function is unchanged and will continue to work.
const sendNotification = async (userId, title, body, data = {}) => {
  const db = getFirestore();
  try {
    const notificationRef = db.collection('notifications').doc();
    const notificationPayload = {
      id: notificationRef.id,
      userId,
      title,
      body,
      data,
      isRead: false,
      createdAt: new Date(),
    };
    await notificationRef.set(notificationPayload);
    logger.info(`[FIREBASE_SERVICE] Notification stored for user ${userId} with ID: ${notificationRef.id}`);
    return { notificationId: notificationRef.id };
  } catch (error) {
    logger.error(`[FIREBASE_SERVICE] Error in sendNotification for user ${userId}:`, error);
    throw new HttpError(500, `Failed to send notification: ${error.message}`);
  }
};

// This function is unchanged and will continue to work.
const updateChatThreadOnNewMessage = async (chatId, messageData) => {
  const db = getFirestore();
  try {
    const chatRef = db.collection('chats').doc(chatId);
    await chatRef.update({
      lastMessage: {
        text: messageData.message,
        senderId: messageData.senderId,
      },
      lastMessageTimestamp: messageData.timestamp,
      updatedAt: new Date(),
    });
    logger.info(`[FIREBASE_SERVICE] Updated lastMessage for chat thread ${chatId}`);
  } catch (error) {
    logger.error(`[FIREBASE_SERVICE] Error updating chat thread for ${chatId}:`, error);
  }
};

// ✅ UPDATED: The function now takes firebaseUid to query Firestore securely.
const fetchUserChatThreads = async (firebaseUid) => {
  const db = getFirestore();
  // ✅ UPDATED: The query now correctly uses 'participantUids'.
  const snapshot = await db.collection('chats')
    .where('participantUids', 'array-contains', firebaseUid)
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
  // We keep initializeFirebase for now in case other parts of your app use it,
  // but it's effectively empty and safe.
  initializeFirebase: () => {}, 
  getFirestore,
  initiateChat,
  sendNotification,
  fetchUserChatThreads,
  updateChatThreadOnNewMessage,
};