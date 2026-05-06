// src/api/v2/loan-readiness/loanReadiness.routes.js
const express = require('express');
const authMiddleware = require('../../../middleware/auth.middleware');
const controller = require('./loanReadiness.controller');

const router = express.Router();
const financeRoles = ['admin', 'manager', 'finance_lead'];

router.get('/management-accounts', authMiddleware(financeRoles), controller.getManagementAccounts);
router.get('/readiness', authMiddleware(financeRoles), controller.getReadiness);
router.get('/funding-pack', authMiddleware(financeRoles), controller.getFundingPack);
router.get('/funding-pack/export', authMiddleware(financeRoles), controller.exportFundingPack);
router.get('/truck-economics', authMiddleware(financeRoles), controller.getTruckEconomics);
router.post('/truck-economics', authMiddleware(financeRoles), controller.getTruckEconomics);
router.post('/loan-scenarios/calculate', authMiddleware(financeRoles), controller.calculateLoanScenario);
router.post('/loan-scenarios', authMiddleware(financeRoles), controller.createLoanScenario);
router.get('/loan-scenarios', authMiddleware(financeRoles), controller.listLoanScenarios);
router.get('/loan-scenarios/:scenarioId', authMiddleware(financeRoles), controller.getLoanScenario);
router.patch('/loan-scenarios/:scenarioId/status', authMiddleware(financeRoles), controller.updateLoanScenarioStatus);
router.get('/loan-scenarios/:scenarioId/export', authMiddleware(financeRoles), controller.exportLoanSchedule);

module.exports = router;
