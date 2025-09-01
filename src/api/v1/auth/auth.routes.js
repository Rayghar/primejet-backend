// File: src/api/v1/auth/auth.routes.js
// ADVISORY: This version fixes the server crash by importing the missing schema.

const express = require('express');
const authController = require('./auth.controller');
const validate = require('../../../middleware/validate.middleware');
const { 
  registerCustomerSchema,
  registerDriverSchema,
  registerAdminSchema,
  loginSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
  verifyOtpSchema,
  verifyPasswordTokenSchema // MODIFIED: Added the missing schema to the import list
} = require('./auth.validation');

const router = express.Router();

// --- Authentication and Registration ---
router.post('/register/customer', validate(registerCustomerSchema), authController.registerCustomer);
router.post('/register/driver', validate(registerDriverSchema), authController.registerDriver);
router.post('/register/admin', validate(registerAdminSchema), authController.registerAdmin);
router.post('/login', validate(loginSchema), authController.login);

// --- OTP Verification ---
router.post('/verify-otp', validate(verifyOtpSchema), authController.verifyEmailOtp);

// --- Password Reset ---
router.post('/request-password-reset', validate(requestPasswordResetSchema), authController.requestPasswordReset);
router.post('/verify-password-token', validate(verifyPasswordTokenSchema), authController.verifyPasswordResetToken);
router.post('/reset-password', validate(resetPasswordSchema), authController.resetPassword);

// --- NEW ROUTE FOR MOBILE SOCIAL LOGIN ---
router.post('/google/mobile-signin', authController.googleMobileSignIn);

module.exports = router;