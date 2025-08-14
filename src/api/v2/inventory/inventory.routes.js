// src/api/v2/inventory/inventory.routes.js
const express = require('express');
const inventoryController = require('./inventory.controller');
const authMiddleware = require('../../../middleware/auth.middleware');
const validate = require('../../../middleware/validate.middleware');
const { addAssetSchema, addLoanSchema, addCylinderSchema, addStockInSchema } = require('./inventory.validation');

const router = express.Router();

// Asset routes
router.get('/assets', authMiddleware('admin'), inventoryController.getAssets);
router.post('/assets', authMiddleware('admin'), validate(addAssetSchema), inventoryController.addAsset);

// Loan routes
router.get('/loans', authMiddleware('admin'), inventoryController.getLoans);
router.post('/loans', authMiddleware('admin'), validate(addLoanSchema), inventoryController.addLoan);
router.delete('/loans/:loanId', authMiddleware('admin'), inventoryController.deleteLoan);

// Cylinder routes
router.get('/cylinders', authMiddleware('admin'), inventoryController.getCylinders);
router.post('/cylinders', authMiddleware('admin'), validate(addCylinderSchema), inventoryController.addCylinder);
router.delete('/cylinders/:cylinderId', authMiddleware('admin'), inventoryController.deleteCylinder);

// Stock-in route
router.post('/stock-in', authMiddleware('admin'), validate(addStockInSchema), inventoryController.addStockIn);

// Inventory Summary route for Dashboard
router.get('/summary', authMiddleware(['admin', 'manager', 'cashier']), inventoryController.getInventorySummary);

// NEW: Endpoint to get LPG stock-in history with profitability
router.get('/stock-in-history', authMiddleware(['admin', 'manager', 'finance_lead']), inventoryController.getLpgStockInHistory);

module.exports = router;