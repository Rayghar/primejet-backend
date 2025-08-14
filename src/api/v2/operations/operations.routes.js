// src/api/v2/operations/operations.routes.js
const express = require('express');
const operationsController = require('./operations.controller');
const authMiddleware = require('../../../middleware/auth.middleware');
const validate = require('../../../middleware/validate.middleware');
const { addPlantSchema, plantIdParamSchema, addMaintenanceLogSchema } = require('./operations.validation'); // Correctly import addMaintenanceLogSchema

const router = express.Router();

// Plant routes
router.get('/plants', authMiddleware(['admin', 'manager']), operationsController.getPlants);
router.post('/plants', authMiddleware('admin'), validate(addPlantSchema), operationsController.addPlant);
router.delete('/plants/:plantId', authMiddleware('admin'), validate(plantIdParamSchema, 'params'), operationsController.deletePlant);

// Van routes
router.get('/vans', authMiddleware(['admin', 'manager', 'driver']), operationsController.getVans);

// Maintenance Log routes
router.post('/plants/:plantId/maintenance', authMiddleware('admin'), validate(plantIdParamSchema, 'params'), validate(addMaintenanceLogSchema), operationsController.addMaintenanceLog);
router.get('/plants/:plantId/maintenance', authMiddleware(['admin', 'manager']), validate(plantIdParamSchema, 'params'), operationsController.getMaintenanceLogs);

// Plant Daily Output History
router.get('/plants/:plantId/daily-output-history', authMiddleware(['admin', 'manager']), validate(plantIdParamSchema, 'params'), operationsController.getPlantDailyOutputHistory);


module.exports = router;