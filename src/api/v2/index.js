// src/api/v2/index.js
const express = require('express');
const router = express.Router();

// Import and use v2 routes for different modules
router.use('/auth', require('./auth/auth.routes'));
router.use('/users', require('./users/user.routes')); // User management routes (e.g., /admin)
router.use('/analytics', require('./analytics/analytics.routes')); // Dashboard & sales analytics routes
router.use('/inventory', require('./inventory/inventory.routes')); // Assets, loans, cylinders, stock-in routes
router.use('/operations', require('./operations/operations.routes')); // Plant status, vans, logistics routes
router.use('/financials', require('./financials/financials.routes')); // Financial statements, revenue assurance routes
router.use('/data-entry', require('./data-entry/data-entry.routes')); // Sales, expenses, daily summaries, transaction history routes
router.use('/logistics', require('./logistics/logistics.routes')); // NEW: Logistics routes
router.use('/customers', require('./customers/customer.routes')); // ADD THIS LINE
router.use('/runs', require('./runs/run.routes')); // ADD THIS LINE
router.use('/finance', require('./finance/finanace.routes')); // Financial statements, revenue assurance routes
router.use('/config', require('./config/config.routes')); // <--- ADD THIS LINE to include config routes!

// Add other v2 routes as they are created (e.g., /config, /reports, /notifications)

/**
 * @route GET /api/v2/status
 * @desc Health check endpoint for the v2 API.
 * @access Public
 */
router.get('/status', (req, res) => res.status(200).send('v2 API is running.'));

module.exports = router;