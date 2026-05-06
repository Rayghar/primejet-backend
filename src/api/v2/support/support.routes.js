// File: src/api/v2/support/support.routes.js
const express = require('express');
const router = express.Router();

const authMiddleware = require('../../../middleware/auth.middleware');
const supportController = require('./support.controller');

// Keep the module secured using the existing auth middleware factory.
// This fixes the prior middleware issue where authMiddleware was passed without calling it.
const requireAdmin = authMiddleware(['admin']);

// Dashboard / hub
router.get('/hub', requireAdmin, supportController.getSupportHub);
router.get('/dashboard', requireAdmin, supportController.getSupportDashboard);

// Tickets / complaints
router.get('/tickets', requireAdmin, supportController.listTickets);
router.post('/tickets', requireAdmin, supportController.createTicket);
router.get('/tickets/:ticketId', requireAdmin, supportController.getTicketById);
router.patch('/tickets/:ticketId', requireAdmin, supportController.updateTicket);
router.post('/tickets/:ticketId/notes', requireAdmin, supportController.addTicketNote);
router.post('/tickets/from-failed-delivery', requireAdmin, supportController.createTicketFromFailedDelivery);

// Customer 360 / timeline
router.get('/customers/:customerId/360', requireAdmin, supportController.getCustomer360);
router.get('/customers/:customerId/timeline', requireAdmin, supportController.getCustomerTimeline);

module.exports = router;
