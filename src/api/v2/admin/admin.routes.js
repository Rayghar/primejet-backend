// File: src/api/v1/admin/admin.routes.js
const express = require('express');
const adminController = require('./admin.controller');
const authMiddleware = require('../../../middleware/auth.middleware');
const validate = require('../../../middleware/validate.middleware');
const { sendNotificationSchema } = require('./admin.validation'); // Import the new validation

const router = express.Router();

// Existing routes
router.get('/dashboard-stats', authMiddleware('admin'), adminController.getDashboardStats);
router.get('/config/payment-gateway', authMiddleware('admin'), adminController.getActivePaymentGateway);
router.patch('/config/payment-gateway', authMiddleware('admin'), adminController.updateActivePaymentGateway);

// ===== NEW ROUTE for sending notifications =====
router.post(
    '/notifications/send',
    authMiddleware('admin'),
    validate(sendNotificationSchema),
    adminController.sendAdminNotification
);
// ===============================================

module.exports = router;