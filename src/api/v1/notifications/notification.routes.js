// File: src/api/v1/notifications/notification.routes.js
const express = require('express');
const notificationController = require('./notification.controller');
const authMiddleware = require('../../../middleware/auth.middleware');
const validate = require('../../../middleware/validate.middleware');
const { notificationIdParamSchema } = require('./notification.validation');

const router = express.Router();

// Get all notifications for the logged-in user
// GET /api/v1/notifications
router.get(
  '/',
  authMiddleware(['customer', 'driver', 'admin']),
  notificationController.getUserNotifications
);

// Get unread count (for bubble/badge)
// GET /api/v1/notifications/unread-count
router.get(
  '/unread-count',
  authMiddleware(['customer', 'driver', 'admin']),
  notificationController.getUnreadCount
);

// Mark all as read
// POST /api/v1/notifications/mark-all-read
router.post(
  '/mark-all-read',
  authMiddleware(['customer', 'driver', 'admin']),
  notificationController.markAllAsRead
);

// Mark a single notification as read
// POST /api/v1/notifications/:notificationId/read
router.post(
  '/:notificationId/read',
  authMiddleware(['customer', 'driver', 'admin']),
  validate({ params: notificationIdParamSchema }),
  notificationController.markAsRead
);

// Clear all notifications for the user
// DELETE /api/v1/notifications/all
router.delete(
  '/all',
  authMiddleware(['customer', 'driver', 'admin']),
  notificationController.clearAll
);

module.exports = router;
