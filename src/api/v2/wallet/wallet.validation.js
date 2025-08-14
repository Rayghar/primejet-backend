// src/api/v1/wallet/wallet.validation.js
const Joi = require('joi');

const initializeTopUpSchema = Joi.object({
  amount: Joi.number().positive().min(100).required().messages({
    'number.base': 'Top-up amount must be a number.',
    'number.positive': 'Top-up amount must be a positive value.',
    'number.min': 'Minimum top-up amount is 100.',
    'any.required': 'Top-up amount is required.',
  }),
});

const confirmTopUpSchema = Joi.object({
  transactionId: Joi.string().required().messages({
    'any.required': 'Transaction ID for the top-up attempt is required.',
  }),
  paymentGatewayReference: Joi.string().required().messages({
    'any.required': 'Payment gateway reference is required to confirm the top-up.',
  }),
});

// ### NEW SCHEMA FOR ADMIN CREDIT ###
const adminCreditWalletSchema = Joi.object({
  amount: Joi.number().integer().positive().required().messages({
    'number.base': 'Credit amount must be a number.',
    'number.integer': 'Credit amount must be an integer (in Kobo).',
    'number.positive': 'Credit amount must be positive.',
    'any.required': 'Credit amount is required.',
  }),
  description: Joi.string().trim().min(5).max(255).required().messages({
    'string.min': 'Description must be at least 5 characters.',
    'string.max': 'Description cannot exceed 255 characters.',
    'any.required': 'A description for the credit is required.',
  }),
  userId: Joi.string().optional(),
  role: Joi.string().valid('customer', 'driver').optional(),
}).xor('userId', 'role') // Ensures either userId or role is provided, but not both
.messages({
  'object.xor': 'You must provide either a single userId or a role (e.g., "customer"), but not both.',
});


module.exports = {
  initializeTopUpSchema,
  confirmTopUpSchema,
  adminCreditWalletSchema, // Export the new schema
};