// File: src/api/v1/notifications/notification.routes.js

const express = require('express');
const notificationController = require('./notification.controller');
const authMiddleware = require('../../../middleware/auth.middleware');
const validate = require('../../../middleware/validate.middleware');
const { notificationIdParamSchema } = require('./notification.validation');

const router = express.Router();

// Route to get all notifications for the logged-in user
// GET /api/v1/notifications
router.get(
  '/',
  authMiddleware(['customer', 'driver', 'admin']),
  notificationController.getUserNotifications
);

// Route to get the count of unread notifications for the bubble
// GET /api/v1/notifications/unread-count
router.get(
  '/unread-count',
  authMiddleware(['customer', 'driver', 'admin']),
  notificationController.getUnreadCount
);

// Route to mark all notifications as read when the user opens the screen
// POST /api/v1/notifications/mark-all-read
router.post(
  '/mark-all-read',
  authMiddleware(['customer', 'driver', 'admin']),
  notificationController.markAllAsRead
);

// ✅ FIX: Added the route to mark a single notification as read.
// This is called by the frontend when a user taps on a notification.
// POST /api/v1/notifications/:notificationId/read
router.post(
  '/:notificationId/read',
  authMiddleware(['customer', 'driver', 'admin']),
  validate({ params: notificationIdParamSchema }),
  notificationController.markAsRead
);

// ✅ FIX: Added the route to delete all notifications for a user.
// This is called by the frontend when the "Clear All" button is pressed.
// DELETE /api/v1/notifications/all
router.delete(
  '/all',
  authMiddleware(['customer', 'driver', 'admin']),
  notificationController.clearAll
);

module.exports = router;
