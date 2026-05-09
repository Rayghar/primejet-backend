// src/api/v2/index.js
const express = require('express');
const router = express.Router();

// Import and use v2 routes for different modules
router.use('/auth', require('./auth/auth.routes'));
router.use('/users', require('./users/user.routes')); // User management routes (e.g., /admin)
router.use('/analytics', require('./analytics/analytics.routes')); // Dashboard & sales analytics routes
router.use('/inventory', require('./inventory/inventory.routes')); // Assets, loans, cylinders, stock-in routes
router.use('/operations', require('./operations/operations.routes')); // Plant status, vans, logistics routes
router.use('/financials', require('./financials/financials.routes'));
router.use('/opening-balances', require('./opening-balances/openingBalance.routes'));
router.use('/pricing', require('./pricing/priceOverride.routes')); // Pricing and price override routes
router.use('/loan-readiness', require('./loan-readiness/loanReadiness.routes')); // Management accounts, loan readiness, projection studio
router.use("/crm", require("./crm/crm.routes")); // Wave 21A Customer CRM command center
router.use('/corporate-clients', require('./corporate-clients/corporateClient.routes')); // Wave A Corporate Client Manager
router.use('/business', require('./business/business.routes')); // Corporate customer portal APIs
router.use('/fleet', require('./fleet/fleet.routes')); // Wave C Advanced Truck Economics & Mobile Inventory Control
router.use("/business-intelligence", require("./business-intelligence/businessIntelligence.routes")); // Wave 21A decision intelligence
router.use("/plant-reliability", require("./plant-reliability/plantReliability.routes")); // Wave 21A plant reliability command center
router.use("/admin-control", require("./admin-control/adminControl.routes")); // Wave 21A administration control center
router.use("/whatsapp", require("./whatsapp/whatsapp.routes")); // Wave 22A WhatsApp conversational business layer
router.use('/data-entry', require('./data-entry/data-entry.routes'));
router.use('/migration', require('./migration/historicalMigration.routes')); // Wave 22C-Plus historical Excel/CSV data migration // Sales, expenses, daily summaries, transaction history routes
router.use('/logistics', require('./logistics/logistics.routes')); // NEW: Logistics routes
router.use('/support', require('./support/support.routes')); // Customer/CRM support desk routes
router.use('/logs', require('./logs/logs.routes')); // API/admin log viewer routes
router.use('/gl', require('./gl/gl.routes')); // General ledger and trial balance routes
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
