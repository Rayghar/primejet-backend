// File: src/api/v1/auth/auth.routes.js
// ADVISORY: Surgical update to add guest + guest upgrade + resend verification routes
// while preserving existing routes and validation wiring.

const express = require('express');
const authController = require('./auth.controller');
const validate = require('../../../middleware/validate.middleware');
const authMiddleware = require('../../../middleware/auth.middleware'); // protects authenticated routes

const {
  registerCustomerSchema,
  registerDriverSchema,
  registerAdminSchema,
  loginSchema,
  requestPasswordResetSchema,
  mobileSignInSchema,
  resetPasswordSchema,
  verifyOtpSchema,
  verifyPasswordTokenSchema,
  // OPTIONAL: If you later add these schemas, you can wire them in.
  // guestSchema,
  // guestUpgradeSchema,
  // resendVerificationSchema,
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

// --- Mobile Social Login ---
router.post('/google/mobile-signin', authController.googleMobileSignIn);
router.post('/apple/mobile-signin', validate(mobileSignInSchema), authController.appleMobileSignIn);

// ===================================================================
// Option A: Guest session + upgrade + resend verification (throttled)
// ===================================================================

// Create guest session (no auth required)
// If you later add a schema, wrap with validate(guestSchema)
router.post('/guest', authController.guest);

// Upgrade guest -> customer (auth required)
// If you later add a schema, use validate(guestUpgradeSchema) before controller
router.post('/guest/upgrade', authMiddleware, authController.guestUpgrade);

// Resend verification OTP (throttled in service)
// If you later add a schema, wrap with validate(resendVerificationSchema)
router.post('/resend-verification', authController.resendVerification);

module.exports = router;
