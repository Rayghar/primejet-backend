// File: src/api/v2/whatsapp/whatsapp.routes.js
const express = require('express');
const authMiddleware = require('../../../middleware/auth.middleware');
const controller = require('./whatsapp.controller');

const router = express.Router();
const requireAdmin = authMiddleware(['admin']);

// Public endpoints required by Meta WhatsApp webhook verification and delivery.
router.get('/webhook', controller.verifyWebhook);
router.post('/webhook', controller.receiveWebhook);

// Admin/business-app control endpoints.
router.get('/settings', requireAdmin, controller.getSettings);
router.patch('/settings', requireAdmin, controller.updateSettings);
router.get('/health', requireAdmin, controller.getHealth);
router.post('/test-connection', requireAdmin, controller.testConnection);
router.post('/test-message', requireAdmin, controller.sendTestMessage);
router.post('/templates/sync', requireAdmin, controller.syncTemplates);
router.get('/dashboard', requireAdmin, controller.getDashboard);
router.get('/setup-checklist', requireAdmin, controller.getSetupChecklist);
router.get('/requests', requireAdmin, controller.listRequests);
router.patch('/requests/:requestId/resolve', requireAdmin, controller.resolveRequest);
router.get('/conversations', requireAdmin, controller.listConversations);
router.get('/conversations/:phone/messages', requireAdmin, controller.getMessagesForPhone);
router.post('/simulate-inbound', requireAdmin, controller.simulateInbound);
router.post('/send-message', requireAdmin, controller.sendManualMessage);

// Wave 22B: WhatsApp order-intake, customer matching and fulfilment handoff.
router.get('/order-drafts', requireAdmin, controller.listOrderDrafts);
router.get('/order-drafts/:draftId', requireAdmin, controller.getOrderDraft);
router.patch('/order-drafts/:draftId', requireAdmin, controller.updateOrderDraft);
router.patch('/order-drafts/:draftId/cancel', requireAdmin, controller.cancelOrderDraft);
router.post('/order-drafts/:draftId/convert-to-order', requireAdmin, controller.convertDraftToOrder);
router.get('/customers/search', requireAdmin, controller.searchCustomers);
router.patch('/contacts/:contactId/link-customer', requireAdmin, controller.linkContactToCustomer);
router.post('/contacts/:contactId/create-customer', requireAdmin, controller.createCustomerFromContact);

module.exports = router;
