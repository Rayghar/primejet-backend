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
    // 1. Find the user in your database
    const user = await User.findOne({ id: userId }).select('fcmTokens').lean();

    if (!user) {
      logger.warn(`[FCM_SERVICE] User not found for ID: ${userId}. Cannot send notification.`);
      return;
    }

    const tokens = user.fcmTokens;

    if (!tokens || tokens.length === 0) {
      logger.info(`[FCM_SERVICE] User ${userId} has no FCM tokens. Skipping notification.`);
      return;
    }

    // 2. Construct the message payload
    const payload = {
      notification: {
        title: title,
        body: body,
      },
      data: {
        ...data, // Include any custom data from the Cloud Function
        click_action: 'FLUTTER_NOTIFICATION_CLICK', // Required for Flutter
      },
    };

    // 3. Send the message using the Firebase Admin SDK
    const response = await admin.messaging().sendToDevice(tokens, payload);
    logger.info(`[FCM_SERVICE] Successfully sent notification to user ${userId}. Response:`, response);

    // Optional: Clean up invalid tokens
    response.results.forEach((result, index) => {
      const error = result.error;
      if (error) {
        logger.error(`[FCM_SERVICE] Failure sending notification to ${tokens[index]}`, error);
        // If a token is no longer valid, you might want to remove it from the user's fcmTokens array
        if (error.code === 'messaging/registration-token-not-registered') {
          // Logic to remove the invalid token from the user's profile
        }
      }
    });

  } catch (error) {
    logger.error(`[FCM_SERVICE] Critical error sending push notification to user ${userId}:`, error);
    // We don't throw here to prevent the calling service from crashing, but we log it.
  }
};

module.exports = {
  sendPushNotification,
};