// File: src/api/v1/auth/auth.validation.js
// ADVISORY: This version adds the new, missing schema to resolve the server crash.

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

// =======================================================================
// NEW: Added the missing schema for the password reset token.
// =======================================================================
const verifyPasswordTokenSchema = Joi.object({
  email: Joi.string().email().required(),
  token: Joi.string().length(6).pattern(/^\d+$/).required().messages({
    'string.length': 'Token must be 6 digits long.',
    'string.pattern.base': 'Token must only contain numbers.',
    'any.required': 'Token is required.',
  }),
});

const mobileSignInSchema = Joi.object({
  idToken: Joi.string().required().messages({
    'any.required': 'ID Token is required.',
  }),
  // Apple may include 'name' and 'email' in the body on the first sign-in, but the ID Token is mandatory.
  name: Joi.string().optional(), 
  email: Joi.string().email().optional(),
  // The client can optionally send the Authorization Code for the refresh token flow (not implemented here)
  authorizationCode: Joi.string().optional(),
});


module.exports = {
  registerCustomerSchema,
  registerDriverSchema,
  registerAdminSchema,
  loginSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
  verifyOtpSchema,
  verifyPasswordTokenSchema, // MODIFIED: Exported the new schema
  mobileSignInSchema,
};