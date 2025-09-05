// src/api/v1/chat/chat.service.js

const User = require('../../../models/user.model');
const Order = require('../../../models/order.model');
const firebaseService = require('../../../services/firebase.service');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config.js');

/**
 * Initiates a chat session between two users related to an order.
 * @param {string} orderId - The ID of the order context for the chat.
 * @param {string} senderId - The ID of the user initiating the chat.
 * @param {string} recipientId - The ID of the user to chat with.
 * @returns {Promise<Object>} - An object containing the chatId and participant details.
 */
const initiateChatSession = async (orderId, senderId, recipientId) => {
  try {
    let sender, recipient, order;

    // --- Step 1: Fetch Sender from MongoDB ---
    try {
      logger.info(`[CHAT_SERVICE] Attempting to find sender: ${senderId}`);
      sender = await User.findOne({ id: senderId }).select('id role name');
      if (!sender) {
        throw new HttpError(404, `Sender (user ID: ${senderId}) not found.`);
      }
      logger.info(`[CHAT_SERVICE] Successfully found sender: ${senderId}`);
    } catch (dbError) {
      logger.error(`[CHAT_SERVICE] !!! MONGODB_ERROR fetching sender ${senderId}:`, dbError);
      throw new Error('Failed during sender lookup in MongoDB.');
    }

    // --- Step 2: Fetch Recipient from MongoDB ---
    try {
      logger.info(`[CHAT_SERVICE] Attempting to find recipient: ${recipientId}`);
      recipient = await User.findOne({ id: recipientId }).select('id role name');
      if (!recipient) {
        throw new HttpError(404, `Recipient (user ID: ${recipientId}) not found.`);
      }
      logger.info(`[CHAT_SERVICE] Successfully found recipient: ${recipientId}`);
    } catch (dbError) {
      logger.error(`[CHAT_SERVICE] !!! MONGODB_ERROR fetching recipient ${recipientId}:`, dbError);
      throw new Error('Failed during recipient lookup in MongoDB.');
    }

    // --- Step 3: Fetch Order from MongoDB ---
    try {
      logger.info(`[CHAT_SERVICE] Attempting to find order: ${orderId}`);
      order = await Order.findOne({ id: orderId }).select('id customerId driverId');
      if (!order) {
        throw new HttpError(404, `Order (ID: ${orderId}) not found for chat context.`);
      }
      logger.info(`[CHAT_SERVICE] Successfully found order: ${orderId}`);
    } catch (dbError) {
      logger.error(`[CHAT_SERVICE] !!! MONGODB_ERROR fetching order ${orderId}:`, dbError);
      throw new Error('Failed during order lookup in MongoDB.');
    }

    // --- Step 4: Perform Authorization Logic ---
    logger.info(`[CHAT_SERVICE] Performing authorization checks for order ${orderId}.`);
    const isSenderCustomer = sender.id === order.customerId;
    const isSenderDriver = sender.id === order.driverId;
    const isRecipientCustomer = recipient.id === order.customerId;
    const isRecipientDriver = recipient.id === order.driverId;
    
    let canChat = false;
    if ((isSenderCustomer && isRecipientDriver) || (isSenderDriver && isRecipientCustomer)) {
        if (order.driverId) canChat = true;
    } else if (sender.role === 'admin' && (isRecipientCustomer || isRecipientDriver)) {
        canChat = true;
    } else if (recipient.role === 'admin' && (isSenderCustomer || isSenderDriver)) {
        canChat = true;
    }

    if (!canChat) {
      logger.warn(`[CHAT_SERVICE] Unauthorized chat attempt: sender ${senderId} for order ${orderId}`);
      throw new HttpError(403, 'These users are not authorized to chat in the context of this order.');
    }
    logger.info(`[CHAT_SERVICE] Authorization successful.`);

    // --- Step 5: Create Chat Thread in Firestore ---
    try {
      logger.info(`[CHAT_SERVICE] Attempting to find or create chat thread in Firestore for order: ${orderId}`);
      await firebaseService.initiateChat(orderId, senderId, recipientId);
      logger.info(`[CHAT_SERVICE] Successfully created/found Firestore chat thread for order ${orderId}.`);
    } catch (fsError) {
      logger.error(`[CHAT_SERVICE] !!! FIREBASE_ERROR creating chat thread for order ${orderId}:`, fsError);
      // Preserve underlying message so controller can surface it (when DEBUG is on)
      throw new HttpError(500, `Firestore chat setup failed: ${fsError.message || 'Unknown Firebase error'}`);
    }

    // --- Step 6: Return Success ---
    logger.info(`[CHAT_SERVICE] Chat session ready for order ${orderId}.`);
    return { chatId: orderId };

  } catch (error) {
    logger.error(`[CHAT_SERVICE] Final error in initiateChatSession for order ${orderId}:`, error.message);
    if (error instanceof HttpError) {
      throw error;
    }
    // When DEBUG is on, include the original error message
    if (process.env.DEBUG_CHAT_ERRORS === '1') {
      throw new HttpError(500, `Unexpected chat error: ${error.message}`);
    }
    throw new HttpError(500, 'Failed to initiate chat session due to an unexpected error.');
  }
};


/**
 * Fetches all of a user's chat threads from Firestore and enriches them with user data from MongoDB.
 * @param {string} userId - The ID of the user whose threads to fetch.
 * @returns {Promise<Array<Object>>} - A list of enriched chat threads.
 */
const getMyThreads = async (userId) => {
  try {
    const threadsData = await firebaseService.fetchUserChatThreads(userId);

    const enrichedThreads = await Promise.all(
      threadsData.map(async (thread) => {
        const otherParticipantId = thread.participants.find(pId => pId !== userId);
        if (!otherParticipantId) return null;

        const otherParticipant = await User.findOne({ id: otherParticipantId }).select('id name photoUrl role');
        if (!otherParticipant) return null;

        return {
          chatId: thread.chatId,
          orderId: thread.orderId,
          otherParticipant: {
            id: otherParticipant.id,
            name: otherParticipant.name,
            role: otherParticipant.role,
            photoUrl: otherParticipant.photoUrl,
          },
          lastMessage: thread.lastMessage,
          lastMessageTimestamp: thread.lastMessageTimestamp,
          // Note: Unread count logic would be implemented here if the feature is added later.
        };
      })
    );

    return enrichedThreads.filter(thread => thread !== null);

  } catch (error) {
    logger.error(`Error in getMyThreads for user ${userId}:`, error);
    throw new HttpError(500, 'Failed to retrieve message threads.');
  }
};

module.exports = {
  initiateChatSession,
  getMyThreads,
};