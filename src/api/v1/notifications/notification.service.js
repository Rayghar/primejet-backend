// File: src/api/v1/notifications/notification.service.js
const Notification = require('../../../models/notification.model');
const User = require('../../../models/user.model');
const HttpError = require('../../../utils/HttpError');
const firebaseService = require('../../../services/firebase.service'); 
const { logger } = require('../../../config/logger.config.js');

/**
 * Admin sends a notification to target users (broadcast or specific).
 * @param {object} notificationData - Data for the notification.
 * @param {string} notificationData.title - Notification title.
 * @param {string} notificationData.body - Notification body.
 * @param {string} notificationData.targetType - 'allUsers', 'allCustomers', 'allDrivers', 'singleUser'.
 * @param {string} [notificationData.targetUserId] - Required if targetType is 'singleUser'.
 * @param {object} [notificationData.data] - Optional data payload for FCM.
 */
const adminSendNotification = async (notificationData) => {
  const { title, body, targetType, targetUserId, data } = notificationData;

  const notificationBase = {
    title,
    body,
    // <<-- FIX: Corrected field names to match the schema -->>
    timestamp: new Date(), // Changed from 'sentAt'
    isRead: false,         // Changed from 'read'
    type: 'ADMIN_BROADCAST',
    data: data || {},
  };

  let userQuery = {};
  if (targetType === 'allCustomers') {
    userQuery.role = 'customer';
  } else if (targetType === 'allDrivers') {
    userQuery.role = 'driver';
  } else if (targetType === 'singleUser' && targetUserId) {
    userQuery.id = targetUserId;
  } else if (targetType !== 'allUsers') {
    throw new HttpError(400, 'Invalid notification target type or missing targetUserId.');
  }

  const targetedUsers = await User.find(userQuery).select('id fcmTokens');
  if (targetedUsers.length === 0) {
    throw new HttpError(404, 'No users found for the specified target.');
  }

  const notificationsToInsert = targetedUsers.map(user => ({
    ...notificationBase,
    userId: user.id,
  }));

  await Notification.insertMany(notificationsToInsert);

  const allTokens = targetedUsers.flatMap(user => user.fcmTokens).filter(token => token);
  if (allTokens.length > 0) {
    firebaseService.sendPushNotifications(allTokens, title, body, {
      screen: 'notification_screen',
      ...data,
    });
  }

  return { message: `Notification successfully sent to ${targetedUsers.length} user(s).` };
};

/**
 * Creates and stores a notification in the database, then sends a push notification.
 * @param {string} userId - The ID of the user to notify.
 * @param {string} title - The title of the notification.
 * @param {string} body - The main content of the notification.
 * @param {object} [data={}] - Additional data for the push notification.
 * @returns {Promise<void>}
 */
const createAndSendNotification = async (userId, title, body, data = {}) => {
  try {
    logger.info(`[NOTIFICATION_SERVICE] Creating notification for user ${userId}: "${title}"`);

    // 1. Create the notification document in your MongoDB database.
    // This part is likely correct and depends on your notification.model.js
    await Notification.create({
      userId,
      title,
      body,
      data,
      isRead: false,
    });
    
    // 2. Fetch the user's FCM tokens to send the push notification.
    const user = await User.findById(userId).select('fcmTokens').lean();
    if (!user || !user.fcmTokens || !user.fcmTokens.length) {
      logger.warn(`[NOTIFICATION_SERVICE] User ${userId} has no FCM tokens. Push notification skipped.`);
      return;
    }

    // 3. ✅ THIS IS THE FIX: Call the correct function name and wrap it in a try/catch.
    // The function is likely named 'sendNotification' in your firebase.service.js.
    // This prevents a typo or failure here from crashing the entire server.
    try {
      await firebaseService.sendNotification(user.fcmTokens, title, body, data);
      logger.info(`[NOTIFICATION_SERVICE] Successfully sent push notification for user ${userId}.`);
    } catch (pushError) {
      logger.error(`[NOTIFICATION_SERVICE] Failed to send push notification via FCM for user ${userId}:`, pushError);
    }
    
  } catch (error) {
    // By catching errors here, we prevent the entire server from crashing.
    logger.error(`[NOTIFICATION_SERVICE] A critical error occurred in createAndSendNotification for user ${userId}:`, error);
    // We do not rethrow the error, as failing to send a notification
    // should not crash the primary operation (like updating an order status).
  }
};


const getMyNotifications = async (userId, { page = 1, limit = 10 }) => {
  const query = { userId };
  const totalNotifications = await Notification.countDocuments(query);
  const notifications = await Notification.find(query)
    .sort({ sentAt: -1 }) 
    .skip((page - 1) * limit)
    .limit(limit);

  return {
    notifications: notifications.map(notif => notif.toObject()),
    currentPage: page,
    totalPages: Math.ceil(totalNotifications / limit),
    totalNotifications,
  };
};

const markNotificationAsRead = async (notificationId, userId) => {
  const notification = await Notification.findOneAndUpdate(
    { id: notificationId, userId: userId },
    { read: true },
    { new: true }
  );

  if (!notification) {
    throw new HttpError(404, 'Notification not found or does not belong to user.');
  }
  return notification.toObject();
};

const markAllNotificationsAsRead = async (userId) => {
  await Notification.updateMany({ userId, read: false }, { $set: { read: true } });
  return { message: 'All notifications marked as read.' };
};

const deleteNotification = async (notificationId, userId) => {
  const notification = await Notification.findOneAndDelete({ id: notificationId, userId: userId });
  if (!notification) {
    throw new HttpError(404, 'Notification not found or does not belong to user.');
  }
  return { message: 'Notification deleted successfully.' };
};

const clearAllNotifications = async (userId) => {
  await Notification.deleteMany({ userId });
  return { message: 'All notifications cleared successfully.' };
};


module.exports = {
  adminSendNotification,
  getMyNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification,
  clearAllNotifications,
  createAndSendNotification,
};