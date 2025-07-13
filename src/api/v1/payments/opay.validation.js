// File: src/api/v1/payments/opay.validation.js
const Joi = require('joi');

// Schema for initializing an OPay payment from the frontend
const initializeOpayPaymentSchema = Joi.object({
  orderId: Joi.string().required().messages({
    'any.required': 'Order ID is required to initialize OPay payment.',
    'string.empty': 'Order ID cannot be empty.',
  }),
  // Add any other fields you might send from the frontend for OPay initialization
  // For example, if you send product details, customer info etc.
  // Although the current Flutter implementation sends PayParams directly,
  // the backend might still need to validate core identifiers.
});

// Schema for verifying an OPay payment (e.g., if you have a manual verification endpoint)
const verifyOpayPaymentSchema = Joi.object({
  orderNo: Joi.string().required().messages({ // OPay's order number
    'any.required': 'OPay order number is required for verification.',
    'string.empty': 'OPay order number cannot be empty.',
  }),
  reference: Joi.string().optional().messages({ // Your internal reference
    'string.empty': 'Reference cannot be empty.',
  }),
});

module.exports = {
    initializeOpayPaymentSchema,
    verifyOpayPaymentSchema,
};