// File: src/api/v1/notifications/notification.service.js
/* eslint-disable no-underscore-dangle */
const Notification = require('../../../models/notification.model');
const User = require('../../../models/user.model');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config.js');

// Optional push service (keep existing path)
let pushNotificationService = null;
try {
  // Your existing service (FCM/APNs bridge, etc.)
  // eslint-disable-next-line import/no-unresolved
  pushNotificationService = require('../../../services/push-notification.service');
} catch (_) {
  pushNotificationService = null;
}

// Optional socket manager (to emit realtime to "user:{userId}")
let io = null;
try {
  // eslint-disable-next-line import/no-unresolved
  const socketManager = require('../../../socket.manager'); // if you centralize io here
  io = socketManager && socketManager.io ? socketManager.io : null;
} catch (_) {
  io = null;
}

/**
 * Build a default actionUrl for deep-linking in the Admin app/web.
 * This is best-effort and can be overridden by passing `actionUrl` in options.
 * @param {string} type
 * @param {object} data
 * @returns {string|undefined}
 */
function buildDefaultActionUrl(type, data = {}) {
  // Keep very conservative mappings to avoid wrong links.
  try {
    switch (type) {
      case 'ORDER_PLACED':
      case 'ORDER_UPDATE':
      case 'PAYMENT_VERIFICATION':
      case 'PAYMENT_DELAYED':
      case 'RUN_UPDATE':
        if (data.orderId) return `/admin/orders/${data.orderId}`;
        if (data.runId) return `/admin/runs/${data.runId}`;
        return undefined;

      case 'SYSTEM':
      default:
        return undefined;
    }
  } catch (_) {
    return undefined;
  }
}

/**
 * Emit a real-time notification to a specific user room if socket.io is available.
 * @param {string} userId
 * @param {object} payload
 */
function emitSocketToUser(userId, payload) {
  try {
    if (!io || !userId) return;
    io.to(`user:${userId}`).emit('notification', payload);
  } catch (e) {
    logger.warn('[NOTIFICATION_SERVICE] socket emit error:', e?.message || e);
  }
}

/**
 * Optional dedup within a time window (to prevent spam on same dedupKey+type).
 * @param {object} params
 * @param {string} params.userId
 * @param {string} params.type
 * @param {string} [params.dedupKey]
 * @param {number} [params.windowSeconds=120]
 * @returns {Promise<boolean>} true if a duplicate exists
 */
async function existsRecentDuplicate({ userId, type, dedupKey, windowSeconds = 120 }) {
  if (!dedupKey) return false;
  const since = new Date(Date.now() - windowSeconds * 1000);
  const dup = await Notification.findOne({
    userId,
    type,
    dedupKey,
    createdAt: { $gte: since },
  }).lean();
  return !!dup;
}

/**
 * Create, persist and send a single notification to one user.
 * - respects dedupKey (if provided)
 * - sets extended fields (priority, source, channels, tags, actionUrl)
 * - emits websocket payload and pushes via push service
 *
 * @param {object} args
 * @param {string} args.userId
 * @param {string} args.title
 * @param {string} args.body
 * @param {string} args.type                      e.g. 'ORDER_PLACED' | 'PAYMENT_DELAYED'
 * @param {object} [args.data={}]                 shallow map of string values (orderId, runId, etc.)
 * @param {string} [args.priority='normal']       'low' | 'normal' | 'high' | 'critical'
 * @param {string} [args.source='system']         'system' | 'order' | 'payment' | 'run' | etc.
 * @param {string} [args.dedupKey]                logical key for server-side dedup
 * @param {string} [args.actionUrl]               explicit deep-link
 * @param {string[]} [args.tags=[]]               labels for filtering (['orders','payments'])
 * @param {string[]} [args.channels=['socket','push']] delivery mediums
 * @param {number} [args.dedupWindowSeconds=120]  duplicate suppression window
 * @returns {Promise<object>} newly created notification (lean)
 */
async function createAndSendNotification({
  userId,
  title,
  body,
  type,
  data = {},
  priority = 'normal',
  source = 'system',
  dedupKey,
  actionUrl,
  tags = [],
  channels = ['socket', 'push'],
  dedupWindowSeconds = 120,
}) {
  try {
    logger.info(
      `[NOTIFICATION_SERVICE] Create→Send user=${userId} type=${type} title="${title}"`
    );

    // Basic validation
    if (!userId || !title || !body || !type) {
      logger.warn('[NOTIFICATION_SERVICE] Missing required fields.');
      throw new HttpError(400, 'Missing required notification fields.');
    }

    // Verify user exists & is active (keeps parity with socket auth style)
    const user = await User.findOne({ id: userId, status: 'active' }).lean();
    if (!user) {
      logger.warn(`[NOTIFICATION_SERVICE] User ${userId} not found or inactive.`);
      throw new HttpError(404, 'User not found or inactive.');
    }

    // Deduplicate (optional)
    if (await existsRecentDuplicate({ userId, type, dedupKey, windowSeconds: dedupWindowSeconds })) {
      logger.info(
        `[NOTIFICATION_SERVICE] Dedup suppressed (user=${userId}, type=${type}, dedupKey=${dedupKey}).`
      );
      // Still return a payload so caller can proceed without error.
      return {
        suppressed: true,
      };
    }

    // Build actionUrl if not provided
    const url = actionUrl || buildDefaultActionUrl(type, data);

    // Persist
    const doc = await Notification.create({
      userId,
      title,
      body,
      type,
      data,
      isRead: false,
      priority,
      source,
      dedupKey,
      actionUrl: url,
      tags,
      channels,
      // deliveredAt/seenAt/readAt are timestamps set later in lifecycle
    });

    // Prepare socket payload (minimal + data for deep-link)
    const payload = {
      id: doc.id,
      title: doc.title,
      body: doc.body,
      type: doc.type,
      priority: doc.priority,
      source: doc.source,
      data: doc.data || {},
      actionUrl: doc.actionUrl,
      createdAt: doc.createdAt,
      // client may render delivered tick if desired:
      deliveredAt: null,
    };

    // Socket channel
    if (channels.includes('socket')) {
      emitSocketToUser(userId, { event: 'notification', notification: payload });
      // Mark deliveredAt on server (best-effort) after socket emit
      try {
        doc.deliveredAt = new Date();
        await doc.save();
      } catch (e) {
        logger.warn('[NOTIFICATION_SERVICE] Failed to set deliveredAt:', e?.message || e);
      }
    }

    // Push channel
    if (channels.includes('push') && pushNotificationService) {
      try {
        // Mirror fields for mobile
        await pushNotificationService.sendNotificationToUser(userId, {
          title,
          body,
          custom: {
            type,
            priority,
            source,
            actionUrl: url || '',
            ...Object.fromEntries(Object.entries(data || {}).map(([k, v]) => [k, String(v)])),
          },
        });
      } catch (e) {
        logger.warn('[NOTIFICATION_SERVICE] push send error:', e?.message || e);
      }
    }

    // Return lean document + a convenience flag
    const leanDoc = doc.toObject();
    return { ...leanDoc, suppressed: false };
  } catch (error) {
    logger.error(
      `[NOTIFICATION_SERVICE] error in createAndSendNotification for user ${userId}:`,
      error
    );
    // Do not throw for “delivery” failures; throw only for clear input/DB errors
    if (error instanceof HttpError) throw error;
    throw new HttpError(500, 'Failed to create notification.');
  }
}

/**
 * Fanout a single notification to many users (keeps separate read states).
 * NOTE: Uses Notification.fanoutToUsers if present on the model; otherwise loops.
 *
 * @param {object} args
 * @param {string[]} args.userIds
 * @param {string} args.title
 * @param {string} args.body
 * @param {string} args.type
 * @param {object} [args.data]
 * @param {string} [args.priority]
 * @param {string} [args.source]
 * @param {string} [args.dedupKey]
 * @param {string} [args.actionUrl]
 * @param {string[]} [args.tags]
 * @param {string[]} [args.channels]
 * @param {number} [args.dedupWindowSeconds]
 * @returns {Promise<{created:number, suppressed:number}>}
 */
async function fanoutNotification(args) {
  const {
    userIds,
    title,
    body,
    type,
    data = {},
    priority = 'normal',
    source = 'system',
    dedupKey,
    actionUrl,
    tags = [],
    channels = ['socket', 'push'],
    dedupWindowSeconds = 120,
  } = args || {};

  if (!Array.isArray(userIds) || userIds.length === 0) {
    throw new HttpError(400, 'userIds required for fanout.');
  }

  // If model has a static fanout helper use it (best performance)
  if (typeof Notification.fanoutToUsers === 'function') {
    const docs = await Notification.fanoutToUsers(userIds, {
      title,
      body,
      type,
      data,
      priority,
      source,
      dedupKey,
      actionUrl,
      tags,
      channels,
    });

    // Emit socket + push for each
    let suppressed = 0;
    for (const doc of docs) {
      emitSocketToUser(doc.userId, {
        event: 'notification',
        notification: {
          id: doc.id,
          title: doc.title,
          body: doc.body,
          type: doc.type,
          priority: doc.priority,
          source: doc.source,
          data: doc.data || {},
          actionUrl: doc.actionUrl,
          createdAt: doc.createdAt,
          deliveredAt: null,
        },
      });
      try {
        doc.deliveredAt = new Date();
        await doc.save();
      } catch (e) {
        logger.warn('[NOTIFICATION_SERVICE] fanout deliveredAt save warn:', e?.message || e);
      }

      if (channels.includes('push') && pushNotificationService) {
        try {
          await pushNotificationService.sendNotificationToUser(doc.userId, {
            title: doc.title,
            body: doc.body,
            custom: {
              type: doc.type,
              priority: doc.priority,
              source: doc.source,
              actionUrl: doc.actionUrl || '',
              ...Object.fromEntries(
                Object.entries(doc.data || {}).map(([k, v]) => [k, String(v)])
              ),
            },
          });
        } catch (e) {
          logger.warn('[NOTIFICATION_SERVICE] fanout push warn:', e?.message || e);
        }
      }
    }
    return { created: docs.length, suppressed };
  }

  // Otherwise, loop and call single-user API
  let created = 0;
  let suppressed = 0;
  for (const uid of userIds) {
    const res = await createAndSendNotification({
      userId: uid,
      title,
      body,
      type,
      data,
      priority,
      source,
      dedupKey,
      actionUrl,
      tags,
      channels,
      dedupWindowSeconds,
    });
    if (res && res.suppressed) suppressed += 1;
    else created += 1;
  }
  return { created, suppressed };
}

/**
 * Fetch recent notifications for a user.
 * Optionally mark them as "seen" (sets seenAt for each unseen).
 *
 * @param {string} userId
 * @param {object} [opts]
 * @param {number} [opts.limit=50]
 * @param {boolean} [opts.markSeen=true]
 * @returns {Promise<Array<object>>}
 */
async function getUserNotifications(userId, opts = {}) {
  const { limit = 50, markSeen = true } = opts;
  try {
    const notifications = await Notification.find({ userId })
      .sort({ createdAt: -1 })
      .limit(Math.max(1, Math.min(limit, 200)))
      .lean();

    if (markSeen && notifications.length > 0) {
      const ids = notifications.filter(n => !n.seenAt).map(n => n.id);
      if (ids.length > 0) {
        await Notification.updateMany(
          { userId, id: { $in: ids } },
          { $set: { seenAt: new Date() } }
        );
      }
    }
    return notifications;
  } catch (error) {
    logger.error(`[NOTIFICATION_SERVICE] getUserNotifications error user=${userId}`, { error });
    throw new HttpError(500, 'Could not retrieve notifications.');
  }
}

/**
 * Get unread count for badge.
 * @param {string} userId
 * @returns {Promise<{unreadCount:number}>}
 */
async function getUnreadCount(userId) {
  try {
    const count = await Notification.countDocuments({
      userId,
      isRead: false,
    });
    return { unreadCount: count };
  } catch (error) {
    logger.error(`[NOTIFICATION_SERVICE] getUnreadCount error user=${userId}`, { error });
    throw new HttpError(500, 'Could not retrieve unread count.');
  }
}

/**
 * Mark a single notification as read (sets isRead=true & readAt).
 * @param {string} notificationId (UUID `id`, not `_id`)
 * @param {string} userId
 * @returns {Promise<object>}
 */
async function markNotificationAsRead(notificationId, userId) {
  const now = new Date();
  const updated = await Notification.findOneAndUpdate(
    { id: notificationId, userId },
    { $set: { isRead: true, readAt: now } },
    { new: true }
  ).lean();

  if (!updated) {
    throw new HttpError(404, 'Notification not found or does not belong to user.');
  }
  return updated;
}

/**
 * Admin: Fetch paginated notifications with filters.
 * @param {object} query
 * @param {number} query.page
 * @param {number} query.limit
 * @param {string} [query.type]
 * @param {boolean} [query.unreadOnly]
 * @returns {Promise<object>} { items: [], total: number, pages: number }
 */
async function getAdminNotifications({ page = 1, limit = 20, type, unreadOnly }) {
  const query = {};

  if (type && type !== 'all') {
    query.type = type;
  }
  if (unreadOnly) {
    query.isRead = false;
  }

  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    Notification.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Notification.countDocuments(query),
  ]);

  return {
    items,
    total,
    currentPage: page,
    totalPages: Math.ceil(total / limit),
    hasMore: skip + items.length < total,
  };
}





/**
 * Mark all notifications as read for the user.
 * @param {string} userId
 * @returns {Promise<{message:string,modified:number}>}
 */
async function markAllAsRead(userId) {
  try {
    const now = new Date();
    const res = await Notification.updateMany(
      { userId, isRead: false },
      { $set: { isRead: true, readAt: now } }
    );
    return { message: 'All notifications marked as read.', modified: res.modifiedCount || 0 };
  } catch (error) {
    logger.error(`[NOTIFICATION_SERVICE] markAllAsRead error user=${userId}`, { error });
    throw new HttpError(500, 'Could not mark notifications as read.');
  }
}

/**
 * Delete a single notification (by logical UUID `id`).
 * @param {string} notificationId
 * @param {string} userId
 * @returns {Promise<{message:string}>}
 */
async function deleteNotification(notificationId, userId) {
  const result = await Notification.deleteOne({ id: notificationId, userId });
  if (result.deletedCount === 0) {
    throw new HttpError(404, 'Notification not found or does not belong to user.');
  }
  return { message: 'Notification deleted successfully.' };
}

/**
 * Clear all notifications for a user.
 * @param {string} userId
 * @returns {Promise<{message:string,deleted:number}>}
 */
async function clearAllNotifications(userId) {
  const res = await Notification.deleteMany({ userId });
  return { message: 'All notifications cleared successfully.', deleted: res.deletedCount || 0 };
}

module.exports = {
  // Single-user
  createAndSendNotification,
  // Fanout
  fanoutNotification,
  // Reads
  getUserNotifications,
  getUnreadCount,
  // Updates
  markNotificationAsRead,
  markAllAsRead,
  // Deletes
  deleteNotification,
  clearAllNotifications,
  getAdminNotifications,
};
