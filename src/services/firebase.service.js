// src/services/firebase.service.js

const admin = require('firebase-admin');
const HttpError = require('../utils/HttpError');
const { logger } = require('../config/logger.config.js');

let firestore;

const initializeFirebase = () => {
  if (admin.apps.length) {
    firestore = admin.firestore();
    logger.info('Firebase Admin SDK already initialized.');
    return;
  }

  let serviceAccount;
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction && process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    try {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
      logger.info('Initializing Firebase Admin SDK using environment variable.');
    } catch (error) {
      logger.error('Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY environment variable.', error);
      throw new Error('Firebase configuration error.');
    }
  } else if (!isProduction) {
    try {
      serviceAccount = require('../../serviceAccountKey.json');
      logger.info('Initializing Firebase Admin SDK using local file.');
    } catch (error) {
      logger.error('Cannot find local serviceAccountKey.json file.', error);
      throw new Error('Local Firebase credentials file not found.');
    }
  } else {
    logger.error('FIREBASE_SERVICE_ACCOUNT_KEY environment variable not set for production.');
    throw new Error('Firebase configuration is missing for production environment.');
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  firestore = admin.firestore();
  logger.info('Firebase Admin SDK Initialized Successfully.');
};

const getFirestore = () => {
  if (!firestore) {
    throw new HttpError(503, 'Firebase (Firestore) has not been initialized.');
  }
  return firestore;
};

const initiateChat = async (orderId, senderId, recipientId) => {
  const db = getFirestore();
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

module.exports = {
  initializeFirebase,
  getFirestore,
  initiateChat,
  sendNotification,
  fetchUserChatThreads,
  updateChatThreadOnNewMessage,
};