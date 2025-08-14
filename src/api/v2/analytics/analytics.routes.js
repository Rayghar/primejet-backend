// src/api/v2/analytics/analytics.routes.js
const express = require('express');
const analyticsController = require('./analytics.controller');
const authMiddleware = require('../../../middleware/auth.middleware');

const router = express.Router();

// Endpoint to get dashboard KPIs. Accessible by relevant roles.
router.get('/dashboard-kpis', authMiddleware(['admin', 'manager', 'finance_lead']), analyticsController.getDashboardKpis);

// Endpoint to get monthly sales data for analytics chart.
router.get('/sales-report', authMiddleware(['admin', 'manager', 'finance_lead']), analyticsController.getSalesReport);

// NEW: Endpoint to get sales breakdown by payment method
router.get('/sales-by-payment-method', authMiddleware(['admin', 'manager', 'finance_lead']), analyticsController.getSalesByPaymentMethod);

// NEW: Endpoint to get sales breakdown by branch
router.get('/sales-by-branch', authMiddleware(['admin', 'manager', 'finance_lead']), analyticsController.getSalesByBranch);

// NEW: Endpoint to get top-selling products
router.get('/top-selling-products', authMiddleware(['admin', 'manager', 'finance_lead']), analyticsController.getTopSellingProducts);


module.exports = router;