// File: src/api/v2/business/business.routes.js
const express = require('express');
const auth = require('../../../middleware/auth.middleware');
const controller = require('./business.controller');

const router = express.Router();

router.use(auth());

router.get('/me', controller.getMe);
router.get('/dashboard', controller.getDashboard);
router.get('/sites', controller.listSites);
router.post('/sites', controller.createSite);
router.get('/requests', controller.listRequests);
router.post('/requests', controller.createRequest);
router.get('/requests/:requestId', controller.getRequest);
router.post('/requests/:requestId/approve', controller.approveRequest);
router.patch('/requests/:requestId/cancel', controller.cancelRequest);
router.get('/deliveries', controller.listFulfilments);
router.post('/deliveries/:fulfilmentId/confirm', controller.confirmDelivery);
router.get('/billing', controller.getBilling);
router.get('/invoices', controller.listInvoices);
router.get('/statements', controller.getStatement);

// Corporate customer support, wallet, promotions and payments.
router.get('/wallet', controller.getWallet);
router.get('/promotions', controller.getPromotions);
router.get('/support/tickets', controller.listSupportTickets);
router.post('/support/tickets', controller.createSupportTicket);
router.get('/support/tickets/:ticketId/messages', controller.listTicketMessages);
router.post('/support/tickets/:ticketId/messages', controller.addTicketMessage);
router.post('/payments/fulfilments/:fulfilmentId/initialize', controller.initializeFulfilmentPayment);

module.exports = router;
