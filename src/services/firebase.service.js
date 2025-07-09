// src/services/firebase.service.js
// Assuming firebase.config.js now exports firestore, admin, etc.
const { firestore, isFirebaseInitialized } = require('../config/firebase.config.js'); // Path from src/services/ to src/config/
const HttpError = require('../utils/HttpError'); // Path from src/services/ to src/utils/
const { logger } = require('../config/logger.config.js'); // For logging
const { admin } = require('../config/firebase.config'); // Ensure admin is exported from your config

/**
 * Initiates a chat session in Firestore between two users for a given order.
 * @param {string} orderId - The ID of the order.
 * @param {string} senderId - The ID of the user sending the initial message/initiating.
 * @param {string} recipientId - The ID of the user receiving the initial message.
 * @returns {Promise<{chatId: string}>} An object containing the ID of the created chat.
 * @throws {HttpError} If Firestore is not initialized or if the chat document creation fails.
 */
const initiateChat = async (orderId, senderId, recipientId) => {
  if (!isFirebaseInitialized || !firestore) {
    logger.error('[FIREBASE_SERVICE] Firestore is not initialized. Cannot initiate chat.');
    throw new HttpError(503, 'Chat service is currently unavailable.'); // 503 Service Unavailable
  }

  try {
    // Construct a consistent and queryable chatId.
    // Sorting participants ensures the same ID regardless of who initiates.
    const participants = [senderId, recipientId].sort();
    const chatId = `${orderId}_${participants[0]}_${participants[1]}`;

    const chatRef = firestore.collection('chats').doc(chatId);
    const chatDoc = await chatRef.get();

    if (!chatDoc.exists) {
      await chatRef.set({
        orderId,
        participants: [senderId, recipientId], // Store original sender/recipient for context if needed
        participantIds: participants, // Sorted array for easier querying
        createdAt: new Date(),
        lastMessage: null,
        lastMessageTimestamp: null,
        updatedAt: new Date(),
        // You might want to add user details like names for easier display on front-end if denormalizing
        // participantInfo: {
        //   [senderId]: { name: senderName, role: senderRole },
        //   [recipientId]: { name: recipientName, role: recipientRole }
        // }
      });
      logger.info(`[FIREBASE_SERVICE] Chat initiated with ID: ${chatId} for order ${orderId}`);
    } else {
      logger.info(`[FIREBASE_SERVICE] Chat already exists with ID: ${chatId} for order ${orderId}`);
      // Optionally update updatedAt timestamp or handle re-initiation logic
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
 * @throws {HttpError} If Firestore is not initialized or if notification creation fails.
 */
const sendNotification = async (userId, title, body, data = {}) => {
  if (!isFirebaseInitialized || !firestore) {
    logger.error('[FIREBASE_SERVICE] Firestore is not initialized. Cannot send notification.');
    throw new HttpError(503, 'Notification service is currently unavailable.');
  }

  try {
    const notificationRef = firestore.collection('notifications').doc(); // Auto-generate ID
    const notificationPayload = {
      id: notificationRef.id,
      userId, // To whom the notification is targeted
      title,
      body,
      data, // Any additional payload for navigation or context
      isRead: false,
      createdAt: new Date(),
      timestamp: new Date(), // Kept for consistency with original file, same as createdAt
    };
    await notificationRef.set(notificationPayload);
    logger.info(`[FIREBASE_SERVICE] Notification stored for user ${userId} with ID: ${notificationRef.id}`);

    // TODO: If using FCM (Firebase Cloud Messaging) for actual push notifications,
    // you would add logic here to send the push message to the user's device token(s).
    // This usually involves:
    // 1. Retrieving the user's FCM device token(s) (stored in your User model or a separate collection).
    // 2. Constructing the FCM message payload.
    // 3. Using `admin.messaging().sendToDevice(tokens, payload)` or similar.

    return { notificationId: notificationRef.id };
  } catch (error) {
    logger.error(`[FIREBASE_SERVICE] Error in sendNotification for user ${userId}:`, error);
    throw new HttpError(500, `Failed to send notification: ${error.message}`);
  }
};

/**
 * <<< FIX: New function to update the parent chat document >>>
 * Updates the lastMessage field on a chat thread document.
 * @param {string} chatId - The ID of the chat document.
 * @param {object} messageData - The data of the message being sent.
 * @returns {Promise<void>}
 */
const updateChatThreadOnNewMessage = async (chatId, messageData) => {
  if (!isFirebaseInitialized || !firestore) {
    logger.error('[FIREBASE_SERVICE] Firestore not initialized. Cannot update chat thread.');
    return;
  }
  try {
    const chatRef = firestore.collection('chats').doc(chatId);
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



const fetchUserChatThreads = async (userId) => {
  const snapshot = await firestore.collection('chats')
    .where('participants', 'array-contains', userId)
    .orderBy('lastMessage.timestamp', 'desc')
    .get();

  if (snapshot.empty) {
    return [];
  }

  const threads = snapshot.docs.map(doc => ({
    chatId: doc.id,
    ...doc.data()
  }));

  return threads;
};


module.exports = {
  initiateChat,
  sendNotification,
  fetchUserChatThreads,
  updateChatThreadOnNewMessage,
};