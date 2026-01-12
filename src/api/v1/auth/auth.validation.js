// File: src/api/v1/auth/auth.validation.js
// ADVISORY: Surgical update — keeps all existing schemas intact and adds ONLY
// the new schemas needed for Option A (guest + guest upgrade + resend verification).

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
// Password reset token schema (existing)
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
  // Allow either idToken OR identityToken
  idToken: Joi.string().optional(),
  identityToken: Joi.string().optional(),

  name: Joi.string().optional().allow('', null),
  email: Joi.string().email().optional().allow('', null),
  authorizationCode: Joi.string().optional(),
}).or('idToken', 'identityToken'); // Require at least one

// =======================================================================
// NEW (Option A): Guest + Upgrade + Resend Verification schemas
// These are intentionally permissive to avoid breaking clients.
// =======================================================================

/**
 * POST /api/v1/auth/guest
 * Optional metadata only (we keep minimal requirements).
 */
const guestSchema = Joi.object({
  name: Joi.string().min(1).max(50).optional().allow('', null),
  phone: Joi.string().pattern(/^\+?\d{10,15}$/).optional().allow('', null),
  deviceId: Joi.string().max(128).optional().allow('', null),
}).unknown(true); // allow extra fields safely

/**
 * POST /api/v1/auth/guest/upgrade  (auth required)
 * Requires email + password; other fields optional.
 */
const guestUpgradeSchema = Joi.object({
  email: Joi.string().email().max(254).required(),
  password: Joi.string().min(6).required(),
  name: Joi.string().min(2).max(50).optional().allow('', null),
  phone: Joi.string().pattern(/^\+?\d{10,15}$/).optional().allow('', null),
}).unknown(true);

/**
 * POST /api/v1/auth/resend-verification
 * Requires email only.
 */
const resendVerificationSchema = Joi.object({
  email: Joi.string().email().max(254).required(),
}).unknown(true);

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

  // Option A additions
  guestSchema,
  guestUpgradeSchema,
  resendVerificationSchema,
};
