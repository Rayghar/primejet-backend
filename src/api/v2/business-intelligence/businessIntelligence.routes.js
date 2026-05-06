// src/api/v2/business-intelligence/businessIntelligence.routes.js
const express = require('express');
const controller = require('./businessIntelligence.controller');
const authMiddleware = require('../../../middleware/auth.middleware');

const router = express.Router();
const roles = ['admin', 'manager', 'finance_lead'];

router.get('/executive', authMiddleware(roles), controller.getExecutiveIntelligence);
router.get('/actions', authMiddleware(roles), controller.getActionRecommendations);
router.get('/modules', authMiddleware(roles), controller.getModuleIntelligence);

module.exports = router;
