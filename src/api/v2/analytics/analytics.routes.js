// src/api/v2/analytics/analytics.routes.js
const express = require('express');
const analyticsController = require('./analytics.controller');
const authMiddleware = require('../../../middleware/auth.middleware');
const { requireBranchScope } = require('../../../middleware/branchScope.middleware');

const router = express.Router();
const enforceInvestorBranchScope = requireBranchScope({ requireBranchForSelected: true, roles: ['investor'] });

const analyticsRoles = ['admin', 'manager', 'finance_lead', 'owner', 'investor', 'auditor', 'operations_manager', 'plant_manager'];

// Existing dashboard/sales analytics
router.get('/gas-plant-dashboard', authMiddleware(analyticsRoles), enforceInvestorBranchScope, analyticsController.getGasPlantDashboard);
router.get('/dashboard-kpis', authMiddleware(analyticsRoles), enforceInvestorBranchScope, analyticsController.getDashboardKpis);
router.get('/sales-report', authMiddleware(analyticsRoles), enforceInvestorBranchScope, analyticsController.getSalesReport);
router.get('/sales-trends', authMiddleware(analyticsRoles), enforceInvestorBranchScope, analyticsController.getSalesReport);
router.get('/sales-by-payment-method', authMiddleware(analyticsRoles), enforceInvestorBranchScope, analyticsController.getSalesByPaymentMethod);
router.get('/sales-by-branch', authMiddleware(analyticsRoles), enforceInvestorBranchScope, analyticsController.getSalesByBranch);
router.get('/top-selling-products', authMiddleware(analyticsRoles), enforceInvestorBranchScope, analyticsController.getTopSellingProducts);

// Wave 14A de-staticized analytics endpoints
router.get('/heatmap', authMiddleware(analyticsRoles), enforceInvestorBranchScope, analyticsController.getHeatmap);
router.get('/business-metrics', authMiddleware(analyticsRoles), enforceInvestorBranchScope, analyticsController.getBusinessMetrics);
router.get('/growth-ltv', authMiddleware(analyticsRoles), enforceInvestorBranchScope, analyticsController.getBusinessMetrics);
router.get('/driver-performance', authMiddleware(analyticsRoles), enforceInvestorBranchScope, analyticsController.getDriverPerformance);
router.get('/branch-performance', authMiddleware(analyticsRoles), enforceInvestorBranchScope, analyticsController.getBranchPerformance);
router.get('/daily-close-performance', authMiddleware(analyticsRoles), enforceInvestorBranchScope, analyticsController.getDailyClosePerformance);

module.exports = router;
