// File: src/api/v1/notifications/notification.service.js
const Notification = require('../../../models/notification.model');
const User = require('../../../models/user.model');
const HttpError = require('../../../utils/HttpError');
//const firebaseService = require('../../../services/firebase.service');

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
  // --- FIX: Destructure directly from notificationData, matching frontend payload ---
  const { title, body, targetType, targetUserId, data } = notificationData;

  const notificationBase = {
    title,
    body,
    sentAt: new Date(),
    read: false,
    type: 'admin_broadcast', // Default type, can be more specific based on targetType
    data: data || {}, // Ensure data is an object, even if empty
  };

  let userQuery = {};
  if (targetType === 'allCustomers') {
    userQuery.role = 'customer';
  } else if (targetType === 'allDrivers') {
    userQuery.role = 'driver';
  } else if (targetType === 'singleUser' && targetUserId) {
    userQuery.id = targetUserId;
  } else if (targetType !== 'allUsers') { // 'allUsers' means no specific role filter
    throw new HttpError(400, 'Invalid notification target type or missing targetUserId.');
  }

  // Find users that match the target, explicitly select fcmTokens
  const targetedUsers = await User.find(userQuery).select('id fcmTokens');
  if (targetedUsers.length === 0) {
    throw new HttpError(404, 'No users found for the specified target.');
  }

  const notificationsToInsert = targetedUsers.map(user => ({
    ...notificationBase,
    userId: user.id,
  }));

  await Notification.insertMany(notificationsToInsert);

  // Send Push Notification via FCM
  /*const allTokens = targetedUsers.flatMap(user => user.fcmTokens).filter(token => token);

  if (allTokens.length > 0) {
    // This is an async call, but we don't need to wait for it to complete
    // to send the response to the admin. This is "fire and forget".
    firebaseService.sendPushNotifications(allTokens, title, body, {
      screen: 'notification_screen', // Example data payload for app navigation
      // You might add specific orderId, chatThreadId etc. here depending on notification type
      ...data, // Merge any custom data provided by admin
    });
  }

  return { message: `Notification successfully sent to ${targetedUsers.length} user(s).` };
});*/
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
};