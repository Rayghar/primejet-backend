// services/fcm.service.js
// Lightweight wrapper around firebase-admin for sending device pushes + token registry
const admin = require('firebase-admin');
const mongoose = require('mongoose');
const User = require('../../../models/user.model');
const Notification = require('../../../models/notification.model');
const { logger } = require('../../../config/logger.config');

// ------------------------------------------------------------------
// Admin initialization
// ------------------------------------------------------------------
let initialized = false;
function ensureInit() {
  if (initialized) return;
  if (!admin.apps.length) {
    const credJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    if (!credJson) {
      admin.initializeApp();
    } else {
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(credJson)),
      });
    }
  }
  initialized = true;
}

// ------------------------------------------------------------------
// Token storage – Now correctly uses the User model
// ------------------------------------------------------------------

// ❌ FIX: The separate UserTokens schema and model have been completely removed.

/**
 * Adds a device token to a user's profile in an idempotent way.
 * @param {string} userId - The ID of the user.
 * @param {string} token - The FCM device token.
 */
async function addToken(userId, token) {
  ensureInit();
  if (!userId || !token) return;
  logger.info(`[FCM_SERVICE] Adding token for user ${userId}`);
  // ✅ CORRECT: Updates the fcmTokens array on the User model directly.
  await User.updateOne(
    { id: userId }, // Use 'id' or '_id' to match your User model schema
    { $addToSet: { fcmTokens: token } }
  );
}

/**
 * Removes a device token from a user's profile.
 * @param {string} userId - The ID of the user.
 * @param {string} token - The FCM device token.
 */
async function removeToken(userId, token) {
  ensureInit();
  if (!userId || !token) return;
  logger.info(`[FCM_SERVICE] Removing token for user ${userId}`);
  // ✅ CORRECT: Updates the fcmTokens array on the User model directly.
  await User.updateOne(
    { id: userId }, // Use 'id' or '_id' to match your User model schema
    { $pull: { fcmTokens: token } }
  );
}

/**
 * Fetches all valid FCM tokens for a given user.
 * @param {string} userId - The ID of the user.
 * @returns {Promise<string[]>} A list of the user's FCM tokens.
 */
async function getTokens(userId) {
  ensureInit();
  const user = await User.findOne({ id: userId }).select('fcmTokens').lean();
  return user?.fcmTokens || [];
}

// ------------------------------------------------------------------
// High-level helpers for sending pushes
// ------------------------------------------------------------------

/**
 * Sends a push notification to a user and handles cleanup of invalid tokens.
 * @param {object} options - The notification options.
 * @param {string} options.recipientId - The ID of the user to notify.
 * @param {string} options.title - The notification title.
 * @param {string} options.body - The notification body.
 * @param {object} [options.data] - The data payload for the notification.
 */
async function notifyMessage({ recipientId, title, body, data }) {
  ensureInit();
  if (!recipientId) return;

  // Persist the notification to the database (optional but recommended)
  try {
    await Notification.create({
      userId: recipientId,
      type: data?.type || 'message',
      title: title || 'New message',
      body: body || '',
      data: data || {},
    });
  } catch (dbError) {
    logger.error(`[FCM_SERVICE] Failed to save notification to DB for user ${recipientId}`, dbError);
  }

  const tokens = await getTokens(recipientId);
  if (!tokens.length) {
    logger.warn(`[FCM_SERVICE] No FCM tokens found for user ${recipientId}. Skipping push.`);
    return;
  }

  const message = {
    notification: { title: title || 'New message', body: body || '', sound: 'default' },
    data: Object.fromEntries(
      Object.entries(data || {}).map(([k, v]) => [k, String(v)])
    ),
    android: { priority: 'high' },
    apns: {
      headers: { 'apns-priority': '10', 'apns-push-type': 'alert' },
      // ✅ FIX: The 'aps' dictionary must be nested inside a 'payload' object for APNs
      payload: {
        aps: {
          sound: 'default',
        },
      },
    },
    tokens,
  };

  try {
    const resp = await admin.messaging().sendEachForMulticast(message);

    // Clean up bad/unregistered tokens
    const badTokens = [];
    resp.responses.forEach((r, i) => {
      if (!r.success) {
        const code = r.error?.code || '';
        if (
          code.includes('registration-token-not-registered') ||
          code.includes('invalid-argument')
        ) {
          badTokens.push(tokens[i]);
        }
      }
    });

    if (badTokens.length > 0) {
      logger.info(`[FCM_SERVICE] Cleaning up ${badTokens.length} invalid tokens for user ${recipientId}`);
      // ✅ FIX: Cleans up tokens from the User model, not the old UserTokens collection.
      await User.updateOne(
        { id: recipientId },
        { $pull: { fcmTokens: { $in: badTokens } } }
      );
    }
  } catch (e) {
    logger.error(`[FCM_SERVICE] sendEachForMulticast error for user ${recipientId}`, e);
  }
}

/**
 * An alias for sending pushes, often used by the Socket.IO layer for compatibility.
 * @param {string} userId - The ID of the user to send the push to.
 * @param {object} message - The raw FCM message payload.
 */
async function pushToUser(userId, message) {
  ensureInit();
  const tokens = await getTokens(userId);
  if (!tokens.length) return;

  const payload = {
    tokens,
    ...message,
  };

  try {
    await admin.messaging().sendEachForMulticast(payload);
  } catch (e) {
    // Swallow error to prevent chat/other flows from breaking on push failure
    logger.warn(`[FCM_SERVICE] pushToUser (socket) failed for user ${userId}`, e);
  }
}

/**
 * NEW: Sends a push notification to a specific user.
 * @param {string} userId - The UUID of the user to notify.
 * @param {object} notificationData - The notification payload.
 * @param {string} notificationData.title - The title of the notification.
 * @param {string} notificationData.body - The body text of the notification.
 * @param {object} [notificationData.data] - Optional data payload for deep linking.
 */
const sendNotificationToUser = async (userId, notificationData) => {
  const user = await User.findOne({ id: userId }).lean();
  if (!user || !user.fcmTokens || user.fcmTokens.length === 0) {
    logger.warn(`[FCM] No FCM tokens found for user ${userId}. Cannot send notification.`);
    return;
  }

  const { title, body, data } = notificationData;

  const message = {
    tokens: user.fcmTokens,
    notification: {
      title: title,
      body: body,
    },
    data: data || {},
    android: {
      priority: 'high',
    },
    apns: {
      payload: {
        aps: {
          'content-available': 1,
          sound: 'default',
        },
      },
    },
  };

  try {
    const response = await admin.messaging().sendMulticast(message);
    logger.info(`[FCM] Successfully sent notification to ${response.successCount} tokens for user ${userId}.`);
    if (response.failureCount > 0) {
      // Optional: Clean up invalid tokens from the user's record
      const tokensToRemove = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success && ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(resp.error.code)) {
          tokensToRemove.push(user.fcmTokens[idx]);
        }
      });
      if (tokensToRemove.length > 0) {
        await User.updateOne({ id: userId }, { $pullAll: { fcmTokens: tokensToRemove } });
        logger.info(`[FCM] Cleaned up ${tokensToRemove.length} invalid tokens for user ${userId}.`);
      }
    }
  } catch (error) {
    logger.error(`[FCM] Error sending notification to user ${userId}:`, error);
  }
};

module.exports = {
  addToken,
  removeToken,
  getTokens,
  notifyMessage,
  pushToUser,
  sendNotificationToUser,
};