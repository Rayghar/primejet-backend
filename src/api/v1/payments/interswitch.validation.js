// File: src/api/v1/payments/payment.validation.js
const Joi = require('joi');

const initializePaymentSchema = Joi.object({
  orderId: Joi.string().required().messages({
    'any.required': 'Order ID is required to initialize payment.',
    'string.empty': 'Order ID cannot be empty.',
  }),
});

const verifyPaymentSchema = Joi.object({
  reference: Joi.string().required().messages({
    'any.required': 'Payment reference is required for verification.',
    'string.empty': 'Payment reference cannot be empty.',
  }),
  orderId: Joi.string().required().messages({
    'any.required': 'Order ID is required for verification.',
    'string.empty': 'Order ID cannot be empty.',
  }),
});

module.exports = { 
    initializePaymentSchema,
    verifyPaymentSchema,
};