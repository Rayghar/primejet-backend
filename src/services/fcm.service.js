// File: src/services/fcm.service.js
const { admin } = require('../config/firebase.config');
const { logger } = require('../config/logger.config');
const User = require('../models/user.model');

/**
 * Sends a push notification to a specific user about their order status change.
 * @param {string} userId - The ID of the user to notify.
 * @param {string} orderId - The ID of the order that was updated.
 * @param {string} newStatus - The new status of the order.
 */
const sendOrderStatusUpdate = async (userId, orderId, newStatus) => {
  if (!admin.apps.length) {
    logger.warn('[FCM_SERVICE] Firebase Admin not initialized. Skipping push notification.');
    return;
  }

  try {
    const user = await User.findOne({ id: userId }).select('fcmTokens').lean();

    if (!user || !user.fcmTokens || user.fcmTokens.length === 0) {
      logger.info(`[FCM_SERVICE] User ${userId} has no registered FCM tokens. Cannot send notification.`);
      return;
    }

    // Use a shortened Order ID for cleaner notification titles
    const shortOrderId = orderId.substring(0, 8);

    const message = {
      notification: {
        title: 'Order Status Updated',
        body: `Your order #${shortOrderId} is now: ${newStatus}`,
      },
      // Data payload is crucial for the client app to handle the notification
      data: {
        orderId: orderId,
        newStatus: newStatus,
        screen: 'order_details', // Helps the client app navigate on tap
        type: 'ORDER_STATUS_UPDATE', // Custom type for client-side filtering
      },
      tokens: user.fcmTokens,
    };

    logger.info(`[FCM_SERVICE] Sending order update notification for order ${orderId} to user ${userId}`);
    const response = await admin.messaging().sendMulticast(message);

    // Good practice: Log failures and clean up invalid tokens
    if (response.failureCount > 0) {
      const failedTokens = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          failedTokens.push(user.fcmTokens[idx]);
        }
      });
      logger.warn(`[FCM_SERVICE] Failed to send notification to ${response.failureCount} tokens:`, failedTokens);
      // Optional: Add logic here to remove invalid tokens from the database
    }
    if (response.successCount > 0) {
        logger.info(`[FCM_SERVICE] Successfully sent notification to ${response.successCount} tokens.`);
    }

  } catch (error) {
    // Robustly handle and log potential Firebase exceptions
    logger.error(`[FCM_SERVICE] Error sending push notification to user ${userId}:`, error);
    if (error.code && error.code.startsWith('messaging/')) {
        logger.error(`[FCM_SERVICE] A Firebase Messaging error occurred: ${error.message}`);
    }
  }
};

module.exports = {
  sendOrderStatusUpdate,
};