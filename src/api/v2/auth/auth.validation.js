// File: src/api/v1/auth/auth.validation.js
const Joi = require('joi');

const registerCustomerSchema = Joi.object({
  name: Joi.string().min(2).max(50).required(),
  email: Joi.string().email().max(254).required(),
  phone: Joi.string().pattern(/^\+?\d{10,15}$/).required(),
  password: Joi.string().min(6).required(),
});

const registerDriverSchema = Joi.object({
  name: Joi.string().min(2).max(50).required(),
  email: Joi.string().email().max(254).required(),
  phone: Joi.string().pattern(/^\+?\d{10,15}$/).required(),
  password: Joi.string().min(6).required(),
  bankDetails: Joi.object({
    bankCode: Joi.string().required(),
    accountNumber: Joi.string().required(),
    accountName: Joi.string().required(),
  }).required(),
});

const registerAdminSchema = Joi.object({
  name: Joi.string().min(2).max(50).required(),
  email: Joi.string().email().max(254).required(),
  phone: Joi.string().pattern(/^\+?\d{10,15}$/).required(),
  password: Joi.string().min(6).required(),
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});

const requestPasswordResetSchema = Joi.object({
  email: Joi.string().email().required(),
});

const resetPasswordSchema = Joi.object({
  token: Joi.string().required(),
  newPassword: Joi.string().min(6).required(),
});

const verifyOtpSchema = Joi.object({
  email: Joi.string().email().required(),
  otp: Joi.string().length(4).pattern(/^\d+$/).required().messages({
    'string.length': 'OTP must be 4 digits long.',
    'string.pattern.base': 'OTP must only contain numbers.',
    'any.required': 'OTP is required.',
  }),
});

module.exports = {
  registerCustomerSchema,
  registerDriverSchema,
  registerAdminSchema,
  loginSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
  verifyOtpSchema,
};
