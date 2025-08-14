// File: src/api/v1/notifications/notification.routes.js
const express = require('express');
const notificationController = require('./notification.controller');
const authMiddleware = require('../../../middleware/auth.middleware');
const validate = require('../../../middleware/validate.middleware');
const { sendNotificationSchema } = require('./notification.validation'); // Import the new schema

const router = express.Router();

console.log('[NOTIFICATION_ROUTES] Registering notification routes...');

// Admin route to send notifications
router.post(
  '/admin/send',
  authMiddleware('admin'), // Only admins can send notifications
  validate(sendNotificationSchema), // Validate the request body
  notificationController.adminSendNotification
);

// Customer routes to manage their own notifications
router.get(
  '/',
  authMiddleware(), // Any authenticated user can get their notifications
  notificationController.getMyNotifications
);

router.post(
  '/:notificationId/read',
  authMiddleware(),
  // Add validation for notificationId if needed
  notificationController.markNotificationAsRead
);

router.post(
  '/mark-all-read',
  authMiddleware(),
  notificationController.markAllNotificationsAsRead
);

router.delete(
  '/:notificationId',
  authMiddleware(),
  // Add validation for notificationId if needed
  notificationController.deleteNotification
);

router.delete(
  '/all',
  authMiddleware(),
  notificationController.clearAllNotifications
);


console.log('[NOTIFICATION_ROUTES] Notification routes registered.');

module.exports = router;