// File: src/api/v1/payments/payment.validation.js
const Joi = require('joi');

const verifyMonnifyPaymentSchema = Joi.object({
  transactionReference: Joi.string().required().messages({
    'any.required': 'Transaction reference is required for verification.',
  }),
  orderId: Joi.string().required().messages({
    'any.required': 'Order ID is required for verification.',
  }),
});

module.exports = { 
    verifyMonnifyPaymentSchema,
};