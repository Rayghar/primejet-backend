// File: src/services/push-notification.service.js

const PushNotifications = require('node-pushnotifications');
const { logger } = require('../config/logger.config');
const User = require('../models/user.model');

// --- Configuration ---
// These values MUST be set in your Render.com Environment Variables
const settings = {
    gcm: {
        id: process.env.FCM_SERVER_KEY,
    },
    apn: {
        token: {
            key: process.env.APNS_KEY_PATH,      // e.g., './certs/AuthKey_YOUR_KEY_ID.p8'
            keyId: process.env.APNS_KEY_ID,
            teamId: process.env.APPLE_TEAM_ID,
        },
        production: process.env.NODE_ENV === 'production',
    },
};

const push = new PushNotifications(settings);

/**
 * Gets all valid FCM/APNs tokens for a given user ID.
 * @param {string} userId - The UUID of the user.
 * @returns {Promise<string[]>} An array of device tokens.
 */
const getTokensForUser = async (userId) => {
    if (!userId) return [];
    try {
        const user = await User.findOne({ id: userId }).select('fcmTokens');
        return user ? user.fcmTokens : [];
    } catch (error) {
        logger.error('[PUSH_SERVICE] Error fetching tokens for user:', { userId, error: error.message });
        return [];
    }
};

/**
 * Sends a push notification to a specific user and handles expired tokens.
 * @param {string} userId - The UUID of the user to notify.
 * @param {object} data - The notification payload ({ title, body, custom: {} }).
 */
const sendNotificationToUser = async (userId, data) => {
    // ✅ ADD THIS BLOCK to save the notification
    try {
        const newNotification = new Notification({
        userId: userId,
        title: data.title,
        body: data.body,
        isRead: false,
        data: data.custom || {},
        });
        await newNotification.save();
    } catch (error) {
        logger.error('[PUSH_SERVICE] Failed to save notification to DB.', { userId, error: error.message });
    }
    
    const deviceTokens = await getTokensForUser(userId);

    if (deviceTokens.length === 0) {
        logger.info(`[PUSH_SERVICE] No device tokens found for user ${userId}. Skipping push notification.`);
        return;
    }

    try {
        const result = await push.send(deviceTokens, data);
        logger.info(`[PUSH_SERVICE] Push notification sent to user ${userId}.`);

        // Handle failed/expired tokens to keep the database clean
        result.forEach(res => {
            if (res.failure > 0) {
                res.message.forEach(async (failure) => {
                    const expiredToken = failure.regId || failure.device;
                    if (expiredToken && (failure.error?.name === 'InvalidRegistration' || failure.response?.reason === 'Unregistered')) {
                        logger.warn(`[PUSH_SERVICE] Removing expired token for user ${userId}: ${expiredToken}`);
                        await User.updateOne({ id: userId }, { $pull: { fcmTokens: expiredToken } });
                    }
                });
            }
        });

    } catch (error) {
        logger.error(`[PUSH_SERVICE] Failed to send push notification to user ${userId}.`, { error: error.message });
    }
};

module.exports = {
    sendNotificationToUser,
};