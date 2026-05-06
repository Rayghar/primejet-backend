// src/api/v2/crm/crm.routes.js
const express = require('express');
const crmController = require('./crm.controller');
const authMiddleware = require('../../../middleware/auth.middleware');

const router = express.Router();
const roles = ['admin', 'manager', 'finance_lead'];

router.get('/dashboard', authMiddleware(roles), crmController.getDashboard);
router.get('/segments', authMiddleware(roles), crmController.getSegments);
router.get('/follow-ups', authMiddleware(roles), crmController.getFollowUps);
router.get('/campaign-targets', authMiddleware(roles), crmController.getCampaignTargets);

module.exports = router;
