// src/services/firebase.service.js

const admin = require('firebase-admin');
const HttpError = require('../utils/HttpError');
const { logger } = require('../config/logger.config.js');

// --- IMPORTANT ---
// 1. Replace this path with the actual path to your service account key file.
// 2. DO NOT commit the 'serviceAccountKey.json' file to your Git repository.
// 3. In production, it's best to load this path from an environment variable.
const serviceAccount = require('../../serviceAccountKey.json'); // Assumes key is in the project root

let firestore;

/**
 * Initializes the Firebase Admin SDK. This should be called once when your server starts.
 */
const initializeFirebase = () => {
  // Check if the app is already initialized to prevent errors
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    firestore = admin.firestore();
    logger.info('Firebase Admin SDK Initialized.');
  }
};

/**
 * Returns the initialized Firestore instance.
 * @returns {FirebaseFirestore.Firestore} The Firestore database instance.
 */
const getFirestore = () => {
  if (!firestore) {
    throw new HttpError(503, 'Firebase (Firestore) has not been initialized. Call initializeFirebase() first.');
  }
  return firestore;
};

/**
 * Initiates a chat session in Firestore between two users for a given order.
 * @param {string} orderId - The ID of the order.
 * * @param {string} senderId - The ID of the user sending the initial message/initiating.
 * @param {string} recipientId - The ID of the user receiving the initial message.
 * @returns {Promise<{chatId: string}>} An object containing the ID of the created chat.
 */
const initiateChat = async (orderId, senderId, recipientId) => {
  const db = getFirestore(); // Get the initialized instance
  try {
    const participants = [senderId, recipientId].sort();
    const chatId = `${orderId}_${participants[0]}_${participants[1]}`;
    const chatRef = db.collection('chats').doc(chatId);
    const chatDoc = await chatRef.get();

    if (!chatDoc.exists) {
      await chatRef.set({
        orderId,
        participants: [senderId, recipientId],
        participantIds: participants,
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
 * Sends/stores a notification for a user in Firestore.
 * @param {string} userId - The ID of the user to notify.
 * @param {string} title - The title of the notification.
 * @param {string} body - The main content of the notification.
 * @param {object} [data={}] - Additional data to store with the notification (e.g., orderId, link).
 * @returns {Promise<{notificationId: string}>} An object containing the ID of the created notification.
 */
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

/**
 * Updates the lastMessage field on a chat thread document.
 * @param {string} chatId - The ID of the chat document.
 * @param {object} messageData - The data of the message being sent.
 * @returns {Promise<void>}
 */
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

/**
 * Fetches all chat threads for a specific user.
 * @param {string} userId - The ID of the user.
 * @returns {Promise<Array<object>>} A list of chat threads.
 */
const fetchUserChatThreads = async (userId) => {
  const db = getFirestore();
  const snapshot = await db.collection('chats')
    .where('participantIds', 'array-contains', userId) // Use the sorted array for querying
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
  initializeFirebase, // <-- Export the initializer
  getFirestore,       // <-- Export the getter
  initiateChat,
  sendNotification,
  fetchUserChatThreads,
  updateChatThreadOnNewMessage,
};