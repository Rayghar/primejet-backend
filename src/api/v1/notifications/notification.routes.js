// File: src/api/v1/notifications/notification.routes.js

const express = require('express');
const notificationController = require('./notification.controller');
const authMiddleware = require('../../../middleware/auth.middleware');

const router = express.Router();

// Route to get all notifications for the logged-in user
// GET /api/v1/notifications
router.get(
  '/',
  authMiddleware(['customer', 'driver']),
  notificationController.getUserNotifications
);

// Route to get the count of unread notifications for the bubble
// GET /api/v1/notifications/unread-count
router.get(
  '/unread-count',
  authMiddleware(['customer', 'driver']),
  notificationController.getUnreadCount
);

// Route to mark all notifications as read when the user opens the screen
// POST /api/v1/notifications/mark-all-read
router.post(
  '/mark-all-read',
  authMiddleware(['customer', 'driver']),
  notificationController.markAllAsRead
);

module.exports = router;