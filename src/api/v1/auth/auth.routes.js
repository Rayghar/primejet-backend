// File: src/api/v1/auth/auth.routes.js

const express = require('express');
const authController = require('./auth.controller');
const validate = require('../../../middleware/validate.middleware');
const authMiddleware = require('../../../middleware/auth.middleware');

const {
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
} = require('./auth.validation');

const router = express.Router();

// --- Authentication and Registration ---
router.post('/register/customer', validate(registerCustomerSchema), authController.registerCustomer);
router.post('/register/driver', validate(registerDriverSchema), authController.registerDriver);
router.post('/register/admin', validate(registerAdminSchema), authController.registerAdmin);
router.post('/login', validate(loginSchema), authController.login);

// --- Guest session + upgrade ---
router.post('/guest', validate(guestSchema), authController.createGuest);
router.post('/guest/upgrade', authMiddleware(), validate(guestUpgradeSchema), authController.upgradeGuest);

// --- OTP Verification ---
router.post('/verify-otp', validate(verifyOtpSchema), authController.verifyEmailOtp);
router.post('/resend-verification', validate(resendVerificationSchema), authController.resendVerificationOtp);

// --- Password Reset ---
router.post('/request-password-reset', validate(requestPasswordResetSchema), authController.requestPasswordReset);
router.post('/verify-password-token', validate(verifyPasswordTokenSchema), authController.verifyPasswordResetToken);
router.post('/reset-password', validate(resetPasswordSchema), authController.resetPassword);

// --- Mobile social login ---
router.post('/google/mobile-signin', authController.googleMobileSignIn);
router.post('/apple/mobile-signin', validate(mobileSignInSchema), authController.appleMobileSignIn);

module.exports = router;
