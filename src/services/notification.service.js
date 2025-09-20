// src/api/v1/notifications/notification.service.js
const Notification = require('../models/notification.model');
const User = require('../models/user.model');
const HttpError = require('../utils/HttpError');
const firebaseService = require('../services/firebase.service'); // <<< IMPORT FIREBASE SERVICE

/**
 * Admin sends a notification to target users (broadcast or specific).
 * @param {object} notificationData - Data for the notification.
 * @param {string} notificationData.title - Notification title.
 * @param {string} notificationData.body - Notification body.
 * @param {string} notificationData.targetType - 'all', 'customers', 'drivers', 'specificUser'.
 * @param {string} [notificationData.targetUserId] - Required if targetType is 'specificUser'.
 */
const adminSendNotification = async (notificationData) => {
  const { title, body, targetType, targetUserId } = notificationData;

  const notification = {
    title,
    body,
    sentAt: new Date(),
    read: false,
    type: 'admin_broadcast', // Default type, can be more specific
  };

  let userQuery = {};
  if (targetType === 'customers') {
    userQuery.role = 'customer';
  } else if (targetType === 'drivers') {
    userQuery.role = 'driver';
  } else if (targetType === 'specificUser' && targetUserId) {
    userQuery.id = targetUserId;
  } else if (targetType !== 'all') {
    throw new HttpError(400, 'Invalid notification target type or missing targetUserId.');
  }

  // Find users that match the target, explicitly select fcmTokens
  const targetedUsers = await User.find(userQuery).select('id fcmTokens'); // <<< GET fcmTokens
  if (targetedUsers.length === 0) {
    throw new HttpError(404, 'No users found for the specified target.');
  }

  const notificationsToInsert = targetedUsers.map(user => ({
    ...notification,
    userId: user.id,
  }));

  await Notification.insertMany(notificationsToInsert);

  // ### NEW LOGIC TO SEND PUSH NOTIFICATION ###
  const allTokens = targetedUsers.flatMap(user => user.fcmTokens).filter(token => token);

  if (allTokens.length > 0) {
    // This is an async call, but we don't need to wait for it to complete
    // to send the response to the admin. This is "fire and forget".
    firebaseService.sendPushNotifications(allTokens, title, body, {
      screen: 'notifications_screen', // Example data payload for app navigation (e.g., to a notifications list)
      // You might add specific orderId, chatThreadId etc. here depending on notification type
    });
  }
  // ### END OF NEW LOGIC ###

  return { message: `Notification successfully sent to ${targetedUsers.length} user(s).` };
};

// Customer-facing service to get their notifications
const getMyNotifications = async (userId, { page = 1, limit = 10 }) => {
  const query = { userId };
  const totalNotifications = await Notification.countDocuments(query);
  const notifications = await Notification.find(query)
    .sort({ sentAt: -1 }) // Newest first
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

const deleteNotification = async (notificationId, userId) => {
  const notification = await Notification.findOneAndDelete({ id: notificationId, userId: userId });
  if (!notification) {
    throw new HttpError(404, 'Notification not found or does not belong to user.');
  }
  return { message: 'Notification deleted successfully.' };
};

module.exports = {
  adminSendNotification,
  getMyNotifications,
  markNotificationAsRead,
  deleteNotification,
};