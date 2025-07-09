// src/api/v1/chat/chat.service.js
const User = require('../../../models/user.model'); // To verify users exist
const Order = require('../../../models/order.model'); // To verify order and participant context
const firebaseService = require('../../../services/firebase.service'); // Path to your global firebase service
const HttpError = require('../../../utils/HttpError');
// const { logger } = require('../../../config/logger.config.js'); // Optional: for structured logging

/**
 * Initiates a chat session between two users related to an order.
 * @param {string} orderId - The ID of the order context for the chat.
 * @param {string} senderId - The ID of the user initiating the chat.
 * @param {string} recipientId - The ID of the user to chat with.
 * @returns {Promise<Object>} - An object containing the chatId.
 * @throws {HttpError} - If users are not found, not related to the order, or chat initiation fails.
 */
const initiateChatSession = async (orderId, senderId, recipientId) => {
  try {
    // 1. Validate that both sender and recipient users exist in your system
    const [sender, recipient, order] = await Promise.all([
      User.findOne({ id: senderId }).select('id role name'),
      User.findOne({ id: recipientId }).select('id role name'),
      Order.findOne({ id: orderId }).select('id customerId driverId') // Fetch relevant order participants
    ]);

    if (!sender) {
      throw new HttpError(404, `Sender (user ID: ${senderId}) not found.`);
    }
    if (!recipient) {
      throw new HttpError(404, `Recipient (user ID: ${recipientId}) not found.`);
    }
    if (!order) {
      throw new HttpError(404, `Order (ID: ${orderId}) not found for chat context.`);
    }

    // 2. (Optional but Recommended) Add business logic:
    //    Ensure the sender and recipient are allowed to chat in the context of this order.
    //    For example, customer can chat with assigned driver, or admin with customer/driver.
    const isSenderCustomer = sender.id === order.customerId;
    const isSenderDriver = sender.id === order.driverId;
    const isRecipientCustomer = recipient.id === order.customerId;
    const isRecipientDriver = recipient.id === order.driverId;

    let canChat = false;
    // Scenario 1: Customer <-> Assigned Driver for the order
    if ((isSenderCustomer && isRecipientDriver) || (isSenderDriver && isRecipientCustomer)) {
        if (order.driverId) { // Ensure driver is actually assigned
            canChat = true;
        } else if (isSenderCustomer && recipient.role === 'admin' || isSenderDriver && recipient.role === 'admin') {
            canChat = true; // Customer/Driver can chat with Admin
        }
    }
    // Scenario 2: Admin <-> Customer or Admin <-> Driver for the order
    else if (sender.role === 'admin' && (isRecipientCustomer || isRecipientDriver)) {
        canChat = true;
    }
    else if (recipient.role === 'admin' && (isSenderCustomer || isSenderDriver)) {
        canChat = true;
    }
    // Add other scenarios as needed (e.g., customer support role)

    if (!canChat) {
      // logger.warn(`[CHAT_SERVICE] Unauthorized chat attempt: sender ${senderId} (${sender.role}), recipient ${recipientId} (${recipient.role}) for order ${orderId}`);
      throw new HttpError(403, 'These users are not authorized to chat in the context of this order.');
    }

    // 3. Call the firebaseService to handle the Firestore interaction
    // The firebaseService.initiateChat was already doing a good job.
    // This service layer adds the validation and business logic before calling it.
    const chatDetails = await firebaseService.initiateChat(orderId, senderId, recipientId);
    // firebaseService.initiateChat returns { chatId }

    // logger.info(`[CHAT_SERVICE] Chat initiated successfully between ${senderId} and ${recipientId} for order ${orderId}. ChatId: ${chatDetails.chatId}`);
    return {
        ...chatDetails,
        message: `Chat session initiated with ${recipient.name}.`,
        participants: [
            { userId: sender.id, name: sender.name, role: sender.role },
            { userId: recipient.id, name: recipient.name, role: recipient.role }
        ]
    };

  } catch (error) {
    // logger.error(`[CHAT_SERVICE] Error initiating chat session between ${senderId} and ${recipientId} for order ${orderId}:`, error);
    if (error instanceof HttpError) {
      throw error;
    }
    // Check if it's a Firebase-specific error from firebaseService
    if (error.message && error.message.includes('Failed to initiate chat')) {
        throw new HttpError(500, error.message); // Propagate Firebase service error
    }
    console.error('Unexpected error in initiateChatSession:', error); // Fallback logging
    throw new HttpError(500, 'Failed to initiate chat session due to an unexpected error.');
  }
};

/**
 * Updates the summary fields on a parent chat document in Firestore.
 * @param {string} chatId - The ID of the chat document (which is the orderId).
 * @param {string} lastMessage - The text of the last message.
 * @param {string} senderId - The ID of the user who sent the message.
 * @returns {Promise<void>}
 */
const updateLastMessage = async (chatId, lastMessage, senderId) => {
  try {
    await firebaseService.updateChatThreadOnNewMessage(chatId, {
      message: lastMessage,
      senderId: senderId,
      timestamp: new Date(), // Use server timestamp for consistency
    });
    logger.info(`[CHAT_SERVICE] Successfully updated last message for chat thread ${chatId}`);
  } catch (error) {
    // We log the error but don't re-throw, as the message itself was already delivered.
    logger.error(`[CHAT_SERVICE] Failed to update last message for chat thread ${chatId}`, error);
  }
};


const getMyThreads = async (userId) => {
  try {
    // This function calls your firebase service to get the raw chat data
    const threadsData = await firebaseService.fetchUserChatThreads(userId);

    // Now, we enrich this data with user details from our MongoDB
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
          lastMessage: thread.lastMessage, // lastMessage comes from firebase service
          hasUnreadMessages: thread.unreadCount > 0,
        };
      })
    );

    // Filter out any null results from users who might have been deleted
    return enrichedThreads.filter(thread => thread !== null);

  } catch (error) {
    console.error(`Error in getMyThreads for user ${userId}:`, error);
    throw new HttpError(500, 'Failed to retrieve message threads.');
  }
}
module.exports = {
  initiateChatSession,
  getMyThreads,
  updateLastMessage,
  // Potentially add other chat-related service methods here in the future:
  // e.g., getChatMessagesForUser, markMessagesAsRead, etc.
};