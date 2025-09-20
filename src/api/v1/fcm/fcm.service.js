// services/fcm.service.js
// Lightweight wrapper around firebase-admin for sending device pushes
const admin = require('firebase-admin');
const Notification = require('../../../models/notification.model');
const UserTokens = require('../models/userTokens.model'); // see note below

let initialized = false;
function ensureInit() {
  if (initialized) return;
  // Expect GOOGLE_APPLICATION_CREDENTIALS or explicit JSON via env
  if (!admin.apps.length) {
    admin.initializeApp({
      // If running on Render/Heroku with env var GOOGLE_APPLICATION_CREDENTIALS_JSON:
      credential: admin.credential.cert(
        JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || '{}')
      ),
    });
  }
  initialized = true;
}

// NOTE: persist per-user device tokens in a tiny collection
//  { userId: 'uuid', tokens: ['fcm1','fcm2', ...] }
const mongoose = require('mongoose');
const userTokensSchema = new mongoose.Schema({
  userId: { type: String, index: true, unique: true },
  tokens: { type: [String], default: [] },
});
const UserTokensModel =
  mongoose.models.UserTokens || mongoose.model('UserTokens', userTokensSchema);

async function addToken(userId, token) {
  ensureInit();
  if (!userId || !token) return;
  await UserTokensModel.updateOne(
    { userId },
    { $addToSet: { tokens: token } },
    { upsert: true }
  );
}

async function removeToken(userId, token) {
  ensureInit();
  if (!userId || !token) return;
  await UserTokensModel.updateOne({ userId }, { $pull: { tokens: token } });
}

async function getTokens(userId) {
  ensureInit();
  const row = await UserTokensModel.findOne({ userId }).lean();
  return row?.tokens || [];
}

// Create DB notification + push to devices
async function notifyMessage({ recipientId, title, body, data }) {
  ensureInit();
  if (!recipientId) return;

  // 1) save notification record
  const notif = await Notification.create({
    userId: recipientId,
    type: 'message',
    title: title || 'New message',
    body: body || '',
    data: data || {},
  });

  // 2) push to all recipient devices
  const tokens = await getTokens(recipientId);
  if (tokens.length === 0) return notif;

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
    await admin.messaging().sendEachForMulticast(message);
  } catch (e) {
    // best-effort; don’t throw
    // console.error('[FCM] sendEachForMulticast error', e);
  }
  return notif;
}

module.exports = {
  addToken,
  removeToken,
  getTokens,
  notifyMessage,
};
