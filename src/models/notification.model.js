// File: src/models/notification.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const VALID_TYPES = [
  'system',     // generic system info
  'order',      // order placed / updated
  'payment',    // payment events (verification delayed, failed, etc.)
  'run',        // run / logistics events
  'chat',       // chat mentions / messages (if you ever reuse)
  'alert',      // high-importance alerts
  'metric'      // KPIs / SLA / performance summaries
];

const VALID_PRIORITIES = ['low', 'normal', 'high', 'urgent'];

const notificationSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      unique: true,
      default: () => uuidv4(),
      index: true,
    },

    // recipient (single user); for admin broadcasts you can fan-out and insert one
    // document per admin userId at creation time (keeps schema simple & compatible)
    userId: {
      type: String,
      required: true,
      ref: 'User',
      index: true,
    },

    title: {
      type: String,
      required: true,
      trim: true,
    },

    body: {
      type: String,
      required: true,
      trim: true,
    },

    // Backward-compat flag; prefer readAt going forward (both are kept in sync)
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },

    // Additional payload for navigation (orderId, runId, etc.)
    // Map<String, String> so existing code keeps working
    data: {
      type: Map,
      of: String,
    },

    // -------------------------
    // New optional fields (non-breaking)
    // -------------------------

    // semantic category for filtering/analytics
    type: {
      type: String,
      enum: VALID_TYPES,
      default: 'system',
      index: true,
    },

    // severity for prioritization / UI badges
    priority: {
      type: String,
      enum: VALID_PRIORITIES,
      default: 'normal',
      index: true,
    },

    // indicates where the event originated (e.g., 'order.service', 'payment.worker')
    source: {
      type: String,
      trim: true,
    },

    // for deduplication across producers; optional
    dedupKey: {
      type: String,
      index: true,
      sparse: true,
    },

    // action URL (deep-link) the client can open (e.g., /admin/orders/:id)
    actionUrl: {
      type: String,
      trim: true,
    },

    // delivery lifecycle timestamps
    deliveredAt: { type: Date }, // pushed to device(s)
    seenAt: { type: Date },      // surfaced in UI list
    readAt: { type: Date },      // opened by user

    // light tagging for dashboards
    tags: {
      type: [String],
      index: true,
      default: undefined, // omit empty array
    },

    // future: multi-channel hints; client can decide how to render
    channels: {
      type: [String], // 'in_app', 'push', 'email', 'sms'
      default: ['in_app'],
    },
  },
  {
    timestamps: true,
    minimize: true,
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform: (_doc, ret) => {
        // normalize id and remove Mongo internals
        ret.id = ret.id || ret._id?.toString();
        delete ret._id;
        return ret;
      },
    },
  }
);

// -------------------------
// Indexes tuned for admin dashboards & INBOX performance
// -------------------------
// Common inbox query: find unread, newest first
notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
// Filter by type within a date window
notificationSchema.index({ userId: 1, type: 1, createdAt: -1 });
// Fast recent reads per user
notificationSchema.index({ userId: 1, readAt: -1 });
// Optional dedup usage across time
notificationSchema.index({ dedupKey: 1, userId: 1 }, { unique: false, sparse: true });

// -------------------------
// Convenience methods (non-breaking)
// -------------------------

/**
 * Mark as delivered (server recorded push/emit).
 */
notificationSchema.methods.markDelivered = async function markDelivered() {
  if (!this.deliveredAt) this.deliveredAt = new Date();
  return this.save();
};

/**
 * Mark as seen (listed in UI).
 */
notificationSchema.methods.markSeen = async function markSeen() {
  if (!this.seenAt) this.seenAt = new Date();
  return this.save();
};

/**
 * Mark as read (opened). Keeps legacy isRead in sync.
 */
notificationSchema.methods.markRead = async function markRead() {
  this.isRead = true;
  if (!this.readAt) this.readAt = new Date();
  return this.save();
};

/**
 * Bulk create helper for admin broadcasts (fan-out).
 * Pass an array of userIds that should receive the same notification.
 */
notificationSchema.statics.fanoutToUsers = async function fanoutToUsers(userIds, doc) {
  if (!Array.isArray(userIds) || userIds.length === 0) return [];
  const payloads = userIds.map((uid) => ({
    ...doc,
    id: uuidv4(),
    userId: uid,
    isRead: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  return this.insertMany(payloads, { ordered: false });
};

const Notification = mongoose.model('Notification', notificationSchema);
module.exports = Notification;
