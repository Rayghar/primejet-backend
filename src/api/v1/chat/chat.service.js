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
    const [sender, recipient, order] = await Promise.all([
      User.findOne({ id: senderId }).select('id role name'),
      User.findOne({ id: recipientId }).select('id role name'),
      Order.findOne({ id: orderId }).select('id customerId driverId')
    ]);

    if (!sender) throw new HttpError(404, `Sender (user ID: ${senderId}) not found.`);
    if (!recipient) throw new HttpError(404, `Recipient (user ID: ${recipientId}) not found.`);
    if (!order) throw new HttpError(404, `Order (ID: ${orderId}) not found for chat context.`);

    // Business logic to ensure only authorized participants can chat.
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

    // Delegate the Firestore interaction to the firebaseService.
    const chatDetails = await firebaseService.initiateChat(orderId, senderId, recipientId);

    logger.info(`[CHAT_SERVICE] Chat initiated successfully for order ${orderId}. ChatId: ${chatDetails.chatId}`);
    
    return {
      ...chatDetails,
      message: `Chat session initiated with ${recipient.name}.`,
      participants: [
        { userId: sender.id, name: sender.name, role: sender.role },
        { userId: recipient.id, name: recipient.name, role: recipient.role }
      ]
    };

  } catch (error) {
    logger.error(`[CHAT_SERVICE] Error initiating chat session for order ${orderId}:`, error);
    if (error instanceof HttpError) throw error;
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