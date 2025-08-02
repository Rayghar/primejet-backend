// File: src/api/v1/admin/admin.routes.js
const express = require('express');
const adminController = require('./admin.controller');
const authMiddleware = require('../../../middleware/auth.middleware');
const authController = require('../auth/auth.controller'); 

const router = express.Router();

// Existing route for dashboard stats
router.get('/dashboard-stats', authMiddleware('admin'), adminController.getDashboardStats);

// New routes for managing the active payment gateway
router.get('/config/payment-gateway', authMiddleware('admin'), adminController.getActivePaymentGateway);
router.patch('/config/payment-gateway', authMiddleware('admin'), adminController.updateActivePaymentGateway);

// NEW ROUTE: Admin creating a new user of any role
router.post('/users', authMiddleware('admin'), authController.adminCreateUser); // NEW ROUTE ADDED

module.exports = router;