// File: src/api/v1/admin/admin.routes.js
const express = require('express');
const adminController = require('./admin.controller');
const authMiddleware = require('../../../middleware/auth.middleware');
const validate = require('../../../middleware/validate.middleware'); // 👈 Add this
const { sendNotificationSchema } = require('./admin.validation'); // 👈 Add this

const router = express.Router();

// Existing route for dashboard stats
router.get('/dashboard-stats', authMiddleware('admin'), adminController.getDashboardStats);

// New routes for managing the active payment gateway
router.get('/config/payment-gateway', authMiddleware('admin'), adminController.getActivePaymentGateway);
router.patch('/config/payment-gateway', authMiddleware('admin'), adminController.updateActivePaymentGateway);
router.post(
  '/send-notification',
  authMiddleware('admin'),
  validate(sendNotificationSchema),
  adminController.sendCustomNotification
);

module.exports = router;