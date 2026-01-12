// File: src/api/v1/auth/auth.validation.js

const Joi = require('joi');

const registerCustomerSchema = Joi.object({
  name: Joi.string().min(2).max(50).required(),
  email: Joi.string().email().max(254).required(),
  phone: Joi.string().pattern(/^\+?\d{10,15}$/).required(),
  password: Joi.string().min(6).required(),
  referralCode: Joi.string().trim().alphanum().optional().allow('', null),
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

const verifyPasswordTokenSchema = Joi.object({
  email: Joi.string().email().required(),
  token: Joi.string().length(6).pattern(/^\d+$/).required().messages({
    'string.length': 'Token must be 6 digits long.',
    'string.pattern.base': 'Token must only contain numbers.',
    'any.required': 'Token is required.',
  }),
});

const mobileSignInSchema = Joi.object({
  idToken: Joi.string().optional(),
  identityToken: Joi.string().optional(),
  name: Joi.string().optional().allow('', null),
  email: Joi.string().email().optional().allow('', null),
  authorizationCode: Joi.string().optional(),
}).or('idToken', 'identityToken');

// NEW: Resend verification email OTP (throttled in service)
const resendVerificationSchema = Joi.object({
  email: Joi.string().email().required(),
});

// NEW: Guest session creation
const guestSchema = Joi.object({
  name: Joi.string().min(2).max(50).required(),
  phone: Joi.string().pattern(/^\+?\d{10,15}$/).required(),
});

// NEW: Guest upgrade -> customer
const guestUpgradeSchema = Joi.object({
  email: Joi.string().email().max(254).required(),
  password: Joi.string().min(8).required(),
  name: Joi.string().min(2).max(50).optional(),
});

module.exports = {
  registerCustomerSchema,
  registerDriverSchema,
  registerAdminSchema,
  loginSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
  verifyOtpSchema,
  verifyPasswordTokenSchema,
  mobileSignInSchema,
  resendVerificationSchema,
  guestSchema,
  guestUpgradeSchema,
};
