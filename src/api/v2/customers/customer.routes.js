// src/api/v2/customers/customer.routes.js
const express = require('express');
const customerController = require('./customer.controller');
const authMiddleware = require('../../../middleware/auth.middleware');
const validate = require('../../../middleware/validate.middleware');
const { addCustomerSchema, addCustomerNoteSchema, customerIdParamSchema } = require('./customer.validation');

const router = express.Router();

// Route to get all customers (for admin/manager)
router.get('/', authMiddleware(['admin', 'manager']), customerController.getCustomers);

// Route to add a new customer
router.post('/', authMiddleware(['admin', 'manager', 'cashier']), validate(addCustomerSchema), customerController.addCustomer);

// Route to get a single customer's details and their orders
router.get('/:customerId', authMiddleware(['admin', 'manager', 'cashier']), validate(customerIdParamSchema, 'params'), customerController.getCustomerDetails);

// Route to get customer's orders
router.get('/:customerId/orders', authMiddleware(['admin', 'manager', 'cashier']), validate(customerIdParamSchema, 'params'), customerController.getCustomerOrders);

// Route to add a note to a customer
router.post('/:customerId/notes', authMiddleware(['admin', 'manager']), validate(customerIdParamSchema, 'params'), validate(addCustomerNoteSchema), customerController.addCustomerNote);

// Route to get customer's notes
router.get('/:customerId/notes', authMiddleware(['admin', 'manager']), validate(customerIdParamSchema, 'params'), customerController.getCustomerNotes);

module.exports = router;