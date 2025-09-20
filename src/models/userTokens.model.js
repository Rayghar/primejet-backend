// File: src/models/userTokens.model.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const UserTokensSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    // Push/notification token (e.g., FCM/APNS/WebPush)
    token: {
      type: String,
      required: true,
      trim: true,
      index: true,
      // If your system may reuse the same token across users (rare), remove `unique: true`.
      unique: true,
    },

    provider: {
      type: String,
      enum: ['fcm', 'apns', 'webpush'],
      default: 'fcm',
      index: true,
    },

    platform: {
      type: String,
      enum: ['android', 'ios', 'web', 'unknown'],
      default: 'unknown',
    },

    deviceId: {
      type: String,
      trim: true,
    },

    deviceName: {
      type: String,
      trim: true,
    },

    appVersion: {
      type: String,
      trim: true,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    lastUsedAt: {
      type: Date,
    },

    lastNotifiedAt: {
      type: Date,
    },

    // Any extra attributes you might want to store
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true, // createdAt, updatedAt
    minimize: true,
  }
);

/**
 * Upsert a token for a user.
 * - Ensures one document per token (unique).
 * - Keeps it activated and updates usage timestamps.
 */
UserTokensSchema.statics.upsertToken = async function upsertToken({
  userId,
  token,
  provider = 'fcm',
  platform = 'unknown',
  deviceId,
  deviceName,
  appVersion,
  metadata,
}) {
  const now = new Date();
  return this.findOneAndUpdate(
    { token },
    {
      $set: {
        userId,
        provider,
        platform,
        deviceId,
        deviceName,
        appVersion,
        isActive: true,
        lastUsedAt: now,
      },
      ...(metadata ? { $setOnInsert: { metadata } } : {}),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

/**
 * Deactivate a token (e.g., on logout/uninstall).
 */
UserTokensSchema.statics.deactivateToken = async function deactivateToken(token) {
  return this.updateOne({ token }, { $set: { isActive: false } });
};

/**
 * Deactivate all tokens for a user (e.g., security reset).
 */
UserTokensSchema.statics.deactivateAllForUser = async function deactivateAllForUser(userId) {
  return this.updateMany({ userId }, { $set: { isActive: false } });
};

// Helpful compound indexes
UserTokensSchema.index({ userId: 1, isActive: 1 });
UserTokensSchema.index({ provider: 1, platform: 1 });

module.exports = mongoose.model('UserTokens', UserTokensSchema);
