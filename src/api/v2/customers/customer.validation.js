// src/api/v2/customers/customer.validation.js
const Joi = require('joi');

// Schema for adding a new customer
const addCustomerSchema = Joi.object({
  name: Joi.string().min(3).max(100).required().description('Customer name.'),
  phone: Joi.string().pattern(/^\+?\d{10,15}$/).required().description('Customer phone number.'),
  email: Joi.string().email().max(255).optional().allow(null, '').description('Customer email address.'),
  type: Joi.string().valid('Individual', 'Corporate').default('Individual').description('Type of customer.'),
});

// Schema for adding a note to a customer
const addCustomerNoteSchema = Joi.object({
  text: Joi.string().min(5).max(1000).required().description('Content of the customer note.'),
  authorEmail: Joi.string().email().optional().description('Email of the user adding the note.'),
});

// Schema for customer ID parameter (reusable)
const customerIdParamSchema = Joi.object({
  // CORRECTED: '4' changed to 'uuidv4'
  customerId: Joi.string().uuid({ version: 'uuidv4' }).required().description('UUID of the customer.'),
});

module.exports = {
  addCustomerSchema,
  addCustomerNoteSchema,
  customerIdParamSchema,
};