// src/api/v2/inventory/inventory.routes.js
const express = require('express');
const inventoryController = require('./inventory.controller');
const authMiddleware = require('../../../middleware/auth.middleware');
const validate = require('../../../middleware/validate.middleware');
const { addAssetSchema, addLoanSchema, addCylinderSchema, addStockInSchema } = require('./inventory.validation');
const { requirePermission } = require('../../../middleware/permission.middleware');
const { requireBranchScope } = require('../../../middleware/branchScope.middleware');

const router = express.Router();
const enforceInvestorBranchScope = requireBranchScope({ requireBranchForSelected: true, roles: ['investor'] });

// Asset routes
router.get('/assets', authMiddleware(['admin', 'finance_lead', 'owner', 'investor', 'auditor', 'accountant']), enforceInvestorBranchScope, inventoryController.getAssets);
router.post('/assets', authMiddleware(['admin', 'finance_lead']), requirePermission('finance.asset-loan.view'), validate(addAssetSchema), inventoryController.addAsset);

// Loan routes
router.get('/loans', authMiddleware(['admin', 'finance_lead', 'owner', 'investor', 'auditor', 'accountant']), enforceInvestorBranchScope, inventoryController.getLoans);
router.post('/loans', authMiddleware(['admin', 'finance_lead']), requirePermission('finance.asset-loan.view'), validate(addLoanSchema), inventoryController.addLoan);
router.delete('/loans/:loanId', authMiddleware(['admin', 'finance_lead']), requirePermission('finance.asset-loan.view'), inventoryController.deleteLoan);

// Cylinder routes
router.get('/cylinders', authMiddleware(['admin', 'finance_lead', 'owner', 'investor', 'auditor', 'accountant', 'inventory_officer', 'operations_manager', 'plant_manager']), enforceInvestorBranchScope, inventoryController.getCylinders);
router.post('/cylinders', authMiddleware(['admin', 'finance_lead', 'inventory_officer']), requirePermission('stock.manage'), validate(addCylinderSchema), inventoryController.addCylinder);
router.delete('/cylinders/:cylinderId', authMiddleware(['admin', 'finance_lead', 'inventory_officer']), requirePermission('stock.manage'), inventoryController.deleteCylinder);

// Stock-in route
router.post('/stock-in', authMiddleware(['admin', 'finance_lead', 'inventory_officer', 'operations_manager']), requirePermission('stock.manage'), validate(addStockInSchema), inventoryController.addStockIn);

// Inventory Summary route for Dashboard
router.get('/summary', authMiddleware(['admin', 'manager', 'cashier', 'finance_lead', 'owner', 'investor', 'auditor', 'inventory_officer', 'operations_manager', 'plant_manager']), enforceInvestorBranchScope, inventoryController.getInventorySummary);

// NEW: Endpoint to get LPG stock-in history with profitability
router.get('/stock-in-history', authMiddleware(['admin', 'manager', 'finance_lead', 'owner', 'investor', 'auditor', 'accountant', 'inventory_officer', 'operations_manager', 'plant_manager']), enforceInvestorBranchScope, inventoryController.getLpgStockInHistory);

// Wave 3 stock, COGS and profitability controls
router.post('/opening-stock', authMiddleware(['admin', 'finance_lead']), requirePermission('finance.opening-balance.manage'), inventoryController.loadOpeningStock);
router.post('/opening-cylinders', authMiddleware(['admin', 'finance_lead']), requirePermission('finance.opening-balance.manage'), inventoryController.loadOpeningCylinderStock);
router.get('/stock-movements', authMiddleware(['admin', 'manager', 'finance_lead', 'owner', 'investor', 'auditor', 'accountant', 'inventory_officer', 'operations_manager', 'plant_manager']), enforceInvestorBranchScope, inventoryController.getStockMovements);
router.post('/reconciliations', authMiddleware(['admin', 'manager', 'finance_lead', 'inventory_officer', 'operations_manager', 'plant_manager']), requirePermission('stock.adjust'), inventoryController.reconcileStock);
router.get('/reconciliations', authMiddleware(['admin', 'manager', 'finance_lead', 'owner', 'investor', 'auditor', 'accountant', 'inventory_officer', 'operations_manager', 'plant_manager']), enforceInvestorBranchScope, inventoryController.getReconciliations);
router.get('/gross-profit', authMiddleware(['admin', 'manager', 'finance_lead', 'owner', 'investor', 'auditor', 'accountant', 'inventory_officer', 'operations_manager', 'plant_manager']), enforceInvestorBranchScope, inventoryController.getGrossProfitReport);
router.get('/branch-profitability', authMiddleware(['admin', 'manager', 'finance_lead', 'owner', 'investor', 'auditor', 'accountant', 'inventory_officer', 'operations_manager', 'plant_manager']), enforceInvestorBranchScope, inventoryController.getBranchProfitabilityReport);
// Wave 9 product, pricing, branch mapping and setup controls
router.get('/products', authMiddleware(['admin', 'manager', 'finance_lead', 'cashier', 'owner', 'investor', 'auditor', 'inventory_officer', 'operations_manager', 'plant_manager']), enforceInvestorBranchScope, inventoryController.listProducts);
router.post('/products', authMiddleware(['admin', 'finance_lead', 'operations_manager']), requirePermission('operations.pricing.manage'), inventoryController.upsertProduct);
router.get('/branch-prices', authMiddleware(['admin', 'manager', 'finance_lead', 'cashier', 'owner', 'investor', 'auditor', 'inventory_officer', 'operations_manager', 'plant_manager']), enforceInvestorBranchScope, inventoryController.listBranchPrices);
router.post('/branch-prices', authMiddleware(['admin', 'finance_lead', 'operations_manager']), requirePermission('operations.pricing.manage'), inventoryController.upsertBranchPrice);
router.get('/price-lookup', authMiddleware(['admin', 'manager', 'finance_lead', 'cashier', 'owner', 'investor', 'auditor', 'inventory_officer', 'operations_manager', 'plant_manager']), enforceInvestorBranchScope, inventoryController.getEffectivePrice);
router.get('/branch-stock-config', authMiddleware(['admin', 'manager', 'finance_lead', 'owner', 'investor', 'auditor', 'accountant', 'inventory_officer', 'operations_manager', 'plant_manager']), enforceInvestorBranchScope, inventoryController.getBranchStockConfig);
router.post('/branch-stock-config', authMiddleware(['admin', 'finance_lead', 'inventory_officer', 'operations_manager']), requirePermission('stock.manage'), inventoryController.saveBranchStockConfig);
router.post('/opening-balances', authMiddleware(['admin', 'finance_lead']), requirePermission('finance.opening-balance.manage'), inventoryController.postOpeningBalances);
router.get('/cogs-readiness', authMiddleware(['admin', 'manager', 'finance_lead', 'owner', 'investor', 'auditor', 'accountant', 'inventory_officer', 'operations_manager', 'plant_manager']), enforceInvestorBranchScope, inventoryController.getCogsReadiness);
router.post('/cogs-activation', authMiddleware(['admin', 'finance_lead']), requirePermission('finance.gl.post'), inventoryController.activateCogs);

module.exports = router;