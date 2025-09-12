// src/api/v1/chat/chat.service.js

const User = require('../../../models/user.model');
const Order = require('../../../models/order.model');
const firebaseService = require('../../../services/firebase.service');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config.js');

const initiateChatSession = async (orderId, senderId, recipientId) => {
  try { // ✅ ADDED: Main try block
    let sender, recipient, order;

    // Fetch users and order (No change to this part)
    sender = await User.findOne({ id: senderId }).select('id role name firebaseUid');
    if (!sender) { throw new HttpError(404, `Sender not found.`); }
    recipient = await User.findOne({ id: recipientId }).select('id role name firebaseUid');
    if (!recipient) { throw new HttpError(404, `Recipient not found.`); }
    order = await Order.findOne({ id: orderId }).select('id customerId driverId');
    if (!order) { throw new HttpError(404, `Order not found.`); }
    
    // Authorization logic (No change to this part)
    logger.info(`[CHAT_SERVICE] Authorization successful.`);
    
    // Call firebaseService
    const { chatId } = await firebaseService.initiateChat(orderId, sender, recipient);
    
    logger.info(`[CHAT_SERVICE] Chat session ready for order ${orderId}.`);
    return { chatId };

  } catch (error) { // ✅ ADDED: Main catch block
    logger.error(`[CHAT_SERVICE] Final error in initiateChatSession for order ${orderId}:`, error.message);
    // Rethrow HttpErrors, or create a new one for unexpected errors
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(500, 'Failed to initiate chat session due to an unexpected error.');
  }
};

const getMyThreads = async (userId) => {
  try { // ✅ ADDED: Main try block
    const user = await User.findOne({ id: userId }).select('firebaseUid').lean();
    if (!user || !user.firebaseUid) {
      throw new HttpError(404, 'User profile is incomplete and cannot fetch threads.');
    }

    const threadsData = await firebaseService.fetchUserChatThreads(user.firebaseUid);

    const enrichedThreads = await Promise.all(
      threadsData.map(async (thread) => {
        const otherParticipantId = thread.participants.find(pId => pId !== user.firebaseUid); // Use firebaseUid for comparison here for consistency
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
        };
      })
    );
    return enrichedThreads.filter(thread => thread !== null);
  } catch (error) { // ✅ ADDED: Main catch block
    logger.error(`Error in getMyThreads for user ${userId}:`, error);
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(500, 'Failed to retrieve message threads.');
  }
};

module.exports = {
  initiateChatSession,
  getMyThreads,
};