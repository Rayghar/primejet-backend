// File: src/api/v1/notifications/notification.service.js
const Notification = require('../../../models/notification.model');
const User = require('../../../models/user.model');
const HttpError = require('../../../utils/HttpError');
const pushNotificationService = require('../../../services/push-notification.service'); 
const { logger } = require('../../../config/logger.config.js');

/**
 * Creates and stores a notification in the database, then sends a push notification.
 * @param {string} userId - The ID of the user to notify.
 * @param {string} title - The title of the notification.
 * @param {string} body - The main content of the notification.
 * @param {string} type - The notification type (e.g., 'ORDER_UPDATE').
 * @param {object} [data={}] - Additional data for the push notification payload.
 * @returns {Promise<void>}
 */
const createAndSendNotification = async (userId, title, body, type, data = {}) => {
  try {
    logger.info(`[NOTIFICATION_SERVICE] Creating notification for user ${userId}: "${title}"`);

    // 1. Create the notification document in the database.
    await Notification.create({
      userId,
      title,
      body,
      type,
      data,
      isRead: false,
    });
    
    // 2. Send the push notification via the dedicated push service.
    // This assumes `pushNotificationService` handles fetching tokens and sending.
    const notificationPayload = {
        title,
        body,
        custom: {
            type,
            ...data, // Merges screen, orderId, etc. into the data payload
        }
    };
    await pushNotificationService.sendNotificationToUser(userId, notificationPayload);
    
  } catch (error) {
    logger.error(`[NOTIFICATION_SERVICE] A critical error occurred in createAndSendNotification for user ${userId}:`, error);
    // We do not rethrow the error, as failing to send a notification
    // should not crash the primary operation (like updating an order status).
  }
};

/**
 * Fetches all notifications for a given user, sorted by most recent.
 * @param {string} userId - The ID of the user.
 * @returns {Promise<Array<object>>}
 */
const getUserNotifications = async (userId) => {
  try {
    const notifications = await Notification.find({ userId }).sort({ createdAt: -1 }).limit(50).lean();
    return notifications;
  } catch (error) {
    logger.error(`Error fetching user notifications for user ${userId}:`, { error });
    throw new HttpError(500, 'Could not retrieve notifications.');
  }
};

/**
 * Gets the count of unread notifications for a user.
 * @param {string} userId - The ID of the user.
 * @returns {Promise<{unreadCount: number}>}
 */
const getUnreadCount = async (userId) => {
  try {
    const count = await Notification.countDocuments({ userId, isRead: false });
    return { unreadCount: count };
  } catch (error) {
    logger.error(`Error fetching unread notification count for user ${userId}:`, { error });
    throw new HttpError(500, 'Could not retrieve unread count.');
  }
};

/**
 * Marks a single notification as read.
 * @param {string} notificationId - The ID of the notification.
 * @param {string} userId - The ID of the user who owns the notification.
 * @returns {Promise<object>}
 */
const markNotificationAsRead = async (notificationId, userId) => {
    const notification = await Notification.findOneAndUpdate(
      // Assumes your notification model has a unique 'id' field, not just '_id'.
      // If using MongoDB's default _id, the query should be { _id: notificationId, userId }.
      { id: notificationId, userId: userId },
      { $set: { isRead: true } },
      { new: true }
    ).lean();
  
    if (!notification) {
      throw new HttpError(404, 'Notification not found or does not belong to user.');
    }
    return notification;
};

/**
 * Marks all unread notifications for a user as read.
 * @param {string} userId - The ID of the user.
 * @returns {Promise<{message: string}>}
 */
const markAllAsRead = async (userId) => {
  try {
    await Notification.updateMany({ userId, isRead: false }, { $set: { isRead: true } });
    return { message: 'All notifications marked as read.' };
  } catch (error) {
    logger.error(`Error marking all notifications as read for user ${userId}:`, { error });
    throw new HttpError(500, 'Could not mark notifications as read.');
  }
};

/**
 * Deletes a single notification.
 * @param {string} notificationId - The ID of the notification.
 * @param {string} userId - The ID of the user who owns the notification.
 * @returns {Promise<{message: string}>}
 */
const deleteNotification = async (notificationId, userId) => {
  const result = await Notification.deleteOne({ id: notificationId, userId: userId });
  if (result.deletedCount === 0) {
    throw new HttpError(404, 'Notification not found or does not belong to user.');
  }
  return { message: 'Notification deleted successfully.' };
};

/**
 * Deletes all notifications for a user.
 * @param {string} userId - The ID of the user.
 * @returns {Promise<{message: string}>}
 */
const clearAllNotifications = async (userId) => {
  await Notification.deleteMany({ userId });
  return { message: 'All notifications cleared successfully.' };
};


module.exports = {
  createAndSendNotification,
  getUserNotifications,
  getUnreadCount,
  markNotificationAsRead,
  markAllAsRead,
  deleteNotification,
  clearAllNotifications,
};
