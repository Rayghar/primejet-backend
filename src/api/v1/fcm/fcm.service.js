// services/fcm.service.js
// Lightweight wrapper around firebase-admin for sending device pushes + token registry
const admin = require('firebase-admin');
const mongoose = require('mongoose');

// If you also save notification records, keep this import:
const Notification = require('../../../models/notification.model'); // optional; safe to keep

// ------------------------------------------------------------------
// Admin initialization – supports GOOGLE_APPLICATION_CREDENTIALS_JSON
// ------------------------------------------------------------------
let initialized = false;
function ensureInit() {
  if (initialized) return;
  if (!admin.apps.length) {
    // If running on Render/Heroku with env var GOOGLE_APPLICATION_CREDENTIALS_JSON:
    // Put the full service-account JSON string in that env var.
    const credJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    if (!credJson) {
      // You can also rely on GOOGLE_APPLICATION_CREDENTIALS (file path) if set in the environment.
      // In that case, omit the explicit initializeApp here and let admin pick it up.
      // For safety, we still try to init with an empty object to avoid “no app” errors.
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
// Token storage – tiny per-user collection (userId -> [tokens])
// ------------------------------------------------------------------
const userTokensSchema = new mongoose.Schema({
  userId: { type: String, index: true, unique: true },
  tokens: { type: [String], default: [] },
});
const UserTokens =
  mongoose.models.UserTokens || mongoose.model('UserTokens', userTokensSchema);

// Add a device token for the user (idempotent)
async function addToken(userId, token) {
  ensureInit();
  if (!userId || !token) return;
  await UserTokens.updateOne(
    { userId },
    { $addToSet: { tokens: token } },
    { upsert: true }
  );
}

// Remove a device token for the user
async function removeToken(userId, token) {
  ensureInit();
  if (!userId || !token) return;
  await UserTokens.updateOne({ userId }, { $pull: { tokens: token } });
}

// Fetch all tokens for a user
async function getTokens(userId) {
  ensureInit();
  const row = await UserTokens.findOne({ userId }).lean();
  return row?.tokens || [];
}

// ------------------------------------------------------------------
// High-level helpers for sending pushes
// ------------------------------------------------------------------

// Generic: push a “chat/new message” type notification + (optionally) persist a DB record
async function notifyMessage({ recipientId, title, body, data }) {
  ensureInit();
  if (!recipientId) return;

  // Optional: persist notification (safe to keep; no-ops if your schema differs)
  try {
    await Notification.create({
      userId: recipientId,
      type: 'message',
      title: title || 'New message',
      body: body || '',
      data: data || {},
    });
  } catch (_) {
    // If you don’t have a notifications model wired up yet, ignore errors here
  }

  const tokens = await getTokens(recipientId);
  if (!tokens.length) return;

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

    // Clean up bad tokens
    const bad = [];
    resp.responses.forEach((r, i) => {
      if (!r.success) {
        const code = r.error?.code || '';
        if (
          code.includes('registration-token-not-registered') ||
          code.includes('invalid-argument')
        ) {
          bad.push(tokens[i]);
        }
      }
    });
    if (bad.length) {
      await UserTokens.updateOne(
        { userId: recipientId },
        { $pull: { tokens: { $in: bad } } }
      );
    }
  } catch (e) {
    // best effort; don’t throw
    // console.error('[FCM] sendEachForMulticast error', e);
  }
}

// Alias used by your Socket layer (keeps earlier code working)
// Accepts the same `message` shape you were building in socket.manager
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
  }
}

module.exports = {
  addToken,
  removeToken,
  getTokens,
  notifyMessage,
  pushToUser, // kept for compatibility with your socket code
};
