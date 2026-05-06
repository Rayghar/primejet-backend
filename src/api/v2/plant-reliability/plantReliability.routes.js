// src/api/v2/plant-reliability/plantReliability.routes.js
const express = require('express');
const controller = require('./plantReliability.controller');
const authMiddleware = require('../../../middleware/auth.middleware');

const router = express.Router();
const roles = ['admin', 'manager', 'finance_lead'];

router.get('/overview', authMiddleware(roles), controller.getOverview);
router.get('/plants/:plantId', authMiddleware(roles), controller.getPlantReliability);
router.get('/plants/:plantId/maintenance-dashboard', authMiddleware(roles), controller.getMaintenanceDashboard);
router.get('/plants/:plantId/assets', authMiddleware(roles), controller.getAssetRegister);
router.post('/plants/:plantId/safety-checks', authMiddleware(['admin', 'manager']), controller.createSafetyCheck);

module.exports = router;
