// services/fcm.service.js
// Lightweight wrapper around firebase-admin for sending device pushes + token registry
const admin = require('firebase-admin');
const mongoose = require('mongoose');
const User = require('../../../models/user.model'); // 👈 IMPORTANT: Import the User model
const Notification = require('../../../models/notification.model'); // optional; safe to keep
const { logger } = require('../../../config/logger.config'); // Assuming logger is available here

// ------------------------------------------------------------------
// Admin initialization – supports GOOGLE_APPLICATION_CREDENTIALS_JSON
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
// const userTokensSchema = new mongoose.Schema(...);
// const UserTokens = mongoose.model('UserTokens', userTokensSchema);

// Add a device token for the user (idempotent)
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

// Remove a device token for the user
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

// Fetch all tokens for a user
async function getTokens(userId) {
  ensureInit();
  const user = await User.findOne({ id: userId }).select('fcmTokens').lean();
  return user?.fcmTokens || [];
}

// ------------------------------------------------------------------
// High-level helpers for sending pushes
// ------------------------------------------------------------------

// Generic: push a notification and optionally persist a DB record
async function notifyMessage({ recipientId, title, body, data }) {
  ensureInit();
  if (!recipientId) return;

  // Optional: persist notification
  try {
    await Notification.create({
      userId: recipientId,
      type: 'message', // Or another relevant type
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
    notification: { title: title || 'New message', body: body || '' },
    data: Object.fromEntries(
      Object.entries(data || {}).map(([k, v]) => [k, String(v)])
    ),
    android: { priority: 'high' },
    apns: { headers: { 'apns-priority': '10' } },
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

// Alias used by your Socket layer (keeps earlier code working)
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
    // swallow – chat flow must not break on push errors
    logger.warn(`[FCM_SERVICE] pushToUser (socket) failed for user ${userId}`, e);
  }
}

module.exports = {
  addToken,
  removeToken,
  getTokens,
  notifyMessage,
  pushToUser, // kept for compatibility with your socket code
};
