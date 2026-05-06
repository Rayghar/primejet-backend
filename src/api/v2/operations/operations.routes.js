// src/api/v2/operations/operations.routes.js
const express = require('express');
const operationsController = require('./operations.controller');
const authMiddleware = require('../../../middleware/auth.middleware');
const validate = require('../../../middleware/validate.middleware');
const { requirePermission } = require('../../../middleware/permission.middleware');
const { requireBranchScope } = require('../../../middleware/branchScope.middleware');
const {
  addPlantSchema,
  plantIdParamSchema,
  addMaintenanceLogSchema,
  addStockInSchema, // ✅ NEW
} = require('./operations.validation');

const router = express.Router();
const enforceInvestorBranchScope = requireBranchScope({ requireBranchForSelected: true, roles: ['investor'] });
const enforceOperationalBranchScope = requireBranchScope({ requireBranchForSelected: true, roles: ['investor', 'cashier', 'plant_manager', 'operations_manager', 'inventory_officer'] });

// Plant routes
router.get('/plants', authMiddleware(['admin', 'manager', 'operations_manager', 'plant_manager', 'finance_lead', 'owner', 'investor', 'auditor', 'cashier', 'inventory_officer']), enforceOperationalBranchScope, operationsController.getPlants);
router.post('/plants', authMiddleware(['admin', 'operations_manager']), requirePermission('operations.plant.manage'), validate(addPlantSchema), operationsController.addPlant);
router.delete('/plants/:plantId', authMiddleware(['admin', 'operations_manager']), requirePermission('operations.plant.manage'), validate(plantIdParamSchema, 'params'), operationsController.deletePlant);
router.get('/plants/:plantId/command-center', authMiddleware(['admin', 'manager', 'finance_lead', 'operations_manager', 'plant_manager', 'owner', 'investor', 'auditor']), enforceInvestorBranchScope, operationsController.getPlantCommandCenter);
router.patch('/plants/:plantId/status', authMiddleware(['admin', 'manager', 'operations_manager', 'plant_manager']), requirePermission('operations.plant.manage'), operationsController.updatePlantStatus);

// Van routes
router.get('/vans', authMiddleware(['admin', 'manager', 'driver']), enforceInvestorBranchScope, operationsController.getVans);

// Maintenance Log routes
router.post(
  '/plants/:plantId/maintenance',
  authMiddleware(['admin', 'operations_manager']),
  requirePermission('operations.plant.manage'),
  validate(plantIdParamSchema, 'params'),
  validate(addMaintenanceLogSchema),
  operationsController.addMaintenanceLog
);
router.get(
  '/plants/:plantId/maintenance',
  authMiddleware(['admin', 'manager', 'operations_manager', 'plant_manager', 'finance_lead', 'owner', 'investor', 'auditor']),
  validate(plantIdParamSchema, 'params'),
  operationsController.getMaintenanceLogs
);

// Plant Daily Output History
router.get(
  '/plants/:plantId/daily-output-history',
  authMiddleware(['admin', 'manager', 'operations_manager', 'plant_manager', 'finance_lead', 'owner', 'investor', 'auditor']),
  validate(plantIdParamSchema, 'params'),
  operationsController.getPlantDailyOutputHistory
);

// ✅ NEW: Stock-Ins
router.get('/stock-ins', authMiddleware(['admin', 'manager', 'operations_manager', 'plant_manager', 'finance_lead', 'owner', 'investor', 'auditor']), enforceInvestorBranchScope, operationsController.getStockIns);
router.post('/stock-ins', authMiddleware(['admin', 'manager', 'operations_manager', 'plant_manager', 'inventory_officer']), requirePermission('stock.manage'), validate(addStockInSchema), operationsController.addStockIn);

module.exports = router;