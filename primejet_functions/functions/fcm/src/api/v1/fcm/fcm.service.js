// File: src/api/v1/fcm/fcm.service.js

const admin = require('firebase-admin');
const User = require('../../../models/user.model');
const { logger } = require('../../../config/logger.config');

/**
 * Sends a push notification to a specific user.
 * @param {string} userId - The ID of the user to notify.
 * @param {string} title - The title of the notification.
 * @param {string} body - The main content of the notification.
 * @param {object} [data={}] - Additional data to send with the message.
 * @returns {Promise<void>}
 */
const sendPushNotification = async (userId, title, body, data = {}) => {
  try {
    const user = await User.findOne({ id: userId }).select('fcmTokens').lean();

    if (!user) {
      logger.warn(`[FCM_SERVICE] User not found for ID: ${userId}.`);
      return;
    }

    const tokens = user.fcmTokens;
    if (!tokens || tokens.length === 0) {
      logger.info(`[FCM_SERVICE] User ${userId} has no FCM tokens. Skipping.`);
      return;
    }

    // Construct the multicast message
    const message = {
      notification: { title, body },
      data: { ...data, click_action: 'FLUTTER_NOTIFICATION_CLICK' },
      tokens: tokens,
    };

    // Use sendMulticast for better handling of multiple tokens
    const response = await admin.messaging().sendMulticast(message);
    logger.info(`[FCM_SERVICE] Sent notification to user ${userId}. Success: ${response.successCount}, Failure: ${response.failureCount}`);

    // --- Start: Invalid Token Cleanup Logic ---
    if (response.failureCount > 0) {
      const tokensToRemove = [];
      response.responses.forEach((result, index) => {
        const error = result.error;
        if (error) {
          logger.error(`[FCM_SERVICE] Failure sending to ${tokens[index]}`, error);
          if (
            error.code === 'messaging/registration-token-not-registered' ||
            error.code === 'messaging/invalid-registration-token'
          ) {
            tokensToRemove.push(tokens[index]);
          }
        }
      });

      if (tokensToRemove.length > 0) {
        logger.info(`[FCM_SERVICE] Removing invalid tokens for user ${userId}:`, tokensToRemove);
        await User.updateOne(
          { id: userId },
          { $pullAll: { fcmTokens: tokensToRemove } }
        );
      }
    }
    // --- End: Invalid Token Cleanup Logic ---

  } catch (error) {
    logger.error(`[FCM_SERVICE] Critical error sending notification to user ${userId}:`, error);
  }
};

module.exports = {
  sendPushNotification,
};