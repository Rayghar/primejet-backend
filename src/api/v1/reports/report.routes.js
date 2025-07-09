// src/api/v1/reports/report.routes.js
const express = require('express');
const reportController = require('./report.controller');
const authMiddleware = require('../../../middleware/auth.middleware');
const validate = require('../../../middleware/validate.middleware');
const { getReportQuerySchema, exportReportQuerySchema } = require('./report.validation'); // Import new schemas

const router = express.Router();

console.log('[REPORT_ROUTES] Registering report routes...');

// Route to get report data (for display in UI)
router.get(
  '/',
  authMiddleware('admin'), // Assuming admin-only access for reports
  validate(getReportQuerySchema, 'query'), // Validate query parameters for getting report data
  reportController.getReport
);

// --- NEW ROUTE FOR EXPORTING REPORTS ---
router.get(
  '/export',
  authMiddleware('admin'), // Only admins can export reports
  validate(exportReportQuerySchema, 'query'), // Validate query parameters for export
  reportController.exportReport
);

console.log('[REPORT_ROUTES] Report routes registered.');

module.exports = router;