// src/api/v2/admin-control/adminControl.routes.js
const express = require('express');
const controller = require('./adminControl.controller');
const authMiddleware = require('../../../middleware/auth.middleware');

const router = express.Router();
router.get('/control-center', authMiddleware('admin'), controller.getControlCenter);
router.get('/data-quality', authMiddleware('admin'), controller.getDataQuality);
router.get('/system-health', authMiddleware('admin'), controller.getSystemHealth);
router.get('/operations-guide', authMiddleware(['admin', 'manager']), controller.getOperationsGuide);

module.exports = router;
