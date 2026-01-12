// File: src/api/v1/auth/auth.controller.js
// NOTE: Surgical update to add guest + upgrade + resend-verification handlers
// without breaking existing flows.

const authService = require('./auth.service');
const authValidation = require('./auth.validation');
const HttpError = require('../../../utils/HttpError');

const registerAdmin = async (req, res, next) => {
  try {
    const { error, value } = authValidation.registerAdminSchema.validate(req.body);
    if (error) {
      throw new HttpError(400, error.details.map(d => d.message).join(', '));
    }
    const result = await authService.registerAdmin(value);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
};

const login = async (req, res, next) => {
  try {
    const { error, value } = authValidation.loginSchema.validate(req.body);
    if (error) {
      throw new HttpError(400, error.details.map(d => d.message).join(', '));
    }
    const result = await authService.login(value.email, value.password);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

const verifyEmailOtp = async (req, res, next) => {
  try {
    const { email, otp } = req.body;
    const result = await authService.verifyEmailOtp(email, otp);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

/**
 * Legacy resend handler (kept to avoid breaking existing clients).
 * NOTE: This is not a true resend; it re-runs registerCustomer.
 */
const resendOtp = async (req, res, next) => {
  try {
    const { email } = req.body;
    // In a real app, you would have a dedicated resend service.
    // For now, re-running register will generate and send a new OTP.
    await authService.registerCustomer({ email, ...req.body });
    res.status(200).json({ message: 'A new verification code has been sent.' });
  } catch (error) {
    next(error);
  }
};

const registerCustomer = async (req, res, next) => {
  try {
    const { error, value } = authValidation.registerCustomerSchema.validate(req.body);
    if (error) {
      throw new HttpError(400, error.details.map(d => d.message).join(', '));
    }
    const result = await authService.registerCustomer(value);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
};

const registerDriver = async (req, res, next) => {
  try {
    const { error, value } = authValidation.registerDriverSchema.validate(req.body);
    if (error) {
      throw new HttpError(400, error.details.map(d => d.message).join(', '));
    }
    const result = await authService.registerDriver(value);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
};

const requestPasswordReset = async (req, res, next) => {
  try {
    const { error, value } = authValidation.requestPasswordResetSchema.validate(req.body);
    if (error) {
      throw new HttpError(400, error.details.map(d => d.message).join(', '));
    }
    const result = await authService.requestPasswordReset(value.email);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

// =======================================================================
// Controller function for password token verification.
// =======================================================================
const verifyPasswordResetToken = async (req, res, next) => {
  try {
    const { email, token } = req.body;
    const result = await authService.verifyPasswordResetToken(email, token);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

const resetPassword = async (req, res, next) => {
  try {
    const { error, value } = authValidation.resetPasswordSchema.validate(req.body);
    if (error) {
      throw new HttpError(400, error.details.map(d => d.message).join(', '));
    }
    const result = await authService.resetPassword(value.token, value.newPassword);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

const googleMobileSignIn = async (req, res, next) => {
  try {
    const { idToken } = req.body;
    if (!idToken) {
      throw new HttpError(400, 'Google ID Token is required.');
    }
    const result = await authService.verifyGoogleIdTokenAndLogin(idToken);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

const appleMobileSignIn = async (req, res, next) => {
  try {
    // Handle both naming conventions
    const idToken = req.body.idToken || req.body.identityToken;

    if (!idToken) {
      throw new HttpError(400, 'Apple Identity Token is required.');
    }

    const result = await authService.verifyAppleIdTokenAndLogin(idToken);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

const adminCreateUser = async (req, res, next) => {
  try {
    // req.user is the authenticated admin from the middleware
    // req.body is the data for the new user to be created
    const newUser = await authService.adminCreateUser(req.body, req.user);
    res.status(201).json(newUser);
  } catch (error) {
    next(error);
  }
};

// =======================================================================
// NEW (Option A): Guest session + upgrade + resend verification (throttled)
// These are intentionally minimal to avoid touching existing logic.
// =======================================================================

/**
 * POST /api/v1/auth/guest
 * Creates a guest user and returns JWT payload via generateJwtForUser()
 */
const guest = async (req, res, next) => {
  try {
    // allow optional meta fields (name/phone/etc) but keep resilient
    const result = await authService.createGuest(req.body || {});
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/auth/guest/upgrade (auth required)
 * Upgrades the currently authenticated guest user to customer.
 * Requires authMiddleware to populate req.user.
 */
const guestUpgrade = async (req, res, next) => {
  try {
    if (!req.user || !req.user.id) {
      throw new HttpError(401, 'Authentication required.');
    }

    // Optional: validate payload if schema exists; otherwise minimal check
    // If you later add schema in auth.validation.js, wire it here.
    const { email, password } = req.body || {};
    if (!email || !password) {
      throw new HttpError(400, 'Email and password are required.');
    }

    const result = await authService.upgradeGuest(req.user.id, req.body);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/auth/resend-verification
 * Sends a new verification OTP (throttled in service).
 */
const resendVerification = async (req, res, next) => {
  try {
    const { email } = req.body || {};
    if (!email) {
      throw new HttpError(400, 'Email is required.');
    }
    const result = await authService.resendVerificationOtp(email);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  registerCustomer,
  registerDriver,
  registerAdmin,
  adminCreateUser,
  googleMobileSignIn,
  appleMobileSignIn,
  login,
  requestPasswordReset,
  verifyPasswordResetToken,
  resetPassword,
  verifyEmailOtp,
  resendOtp,

  // --- Option A additions ---
  guest,
  guestUpgrade,
  resendVerification,
};
