// File: src/api/v2/corporate-clients/corporateClient.routes.js
const express = require('express');
const auth = require('../../../middleware/auth.middleware');
const controller = require('./corporateClient.controller');

const router = express.Router();

const readRoles = ['admin', 'owner', 'investor', 'auditor', 'manager', 'operations_manager', 'plant_manager', 'finance_lead', 'accountant', 'sales_agent', 'support_agent'];
const manageRoles = ['admin', 'manager', 'operations_manager', 'plant_manager', 'finance_lead', 'sales_agent'];

router.get('/dashboard', auth(readRoles), controller.getDashboard);
router.get('/fulfilment-control', auth(readRoles), controller.getFulfilmentControl);
router.get('/relationship-managers', auth(readRoles), controller.getRelationshipManagers);
router.get('/fulfilments', auth(readRoles), controller.listFulfilments);
router.patch('/fulfilments/:fulfilmentId/status', auth(manageRoles), controller.updateFulfilmentStatus);
router.get('/', auth(readRoles), controller.listClients);
router.post('/', auth(manageRoles), controller.createClient);
router.get('/:clientId', auth(readRoles), controller.getClient);
router.patch('/:clientId', auth(manageRoles), controller.updateClient);
router.post('/:clientId/activities', auth(manageRoles), controller.addActivity);
router.get('/:clientId/fulfilments', auth(readRoles), controller.listFulfilments);
router.post('/:clientId/fulfilments', auth(manageRoles), controller.createFulfilment);
router.patch('/:clientId/fulfilments/:fulfilmentId', auth(manageRoles), controller.updateFulfilment);
router.patch('/:clientId/link-whatsapp', auth(manageRoles), controller.linkWhatsAppContact);

module.exports = router;
