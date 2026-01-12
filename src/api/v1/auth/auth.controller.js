// File: src/api/v1/auth/auth.controller.js

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

// NEW: Resend verification OTP (throttled)
const resendVerificationOtp = async (req, res, next) => {
  try {
    const { email } = req.body;
    const result = await authService.resendVerificationOtp(email);
    res.status(200).json(result);
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

// NEW: Guest create session
const createGuest = async (req, res, next) => {
  try {
    const { error, value } = authValidation.guestSchema.validate(req.body);
    if (error) {
      throw new HttpError(400, error.details.map(d => d.message).join(', '));
    }
    const result = await authService.createGuest(value);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

// NEW: Upgrade guest -> customer (uses /api/v1/auth/guest/upgrade)
const upgradeGuest = async (req, res, next) => {
  try {
    const { error, value } = authValidation.guestUpgradeSchema.validate(req.body);
    if (error) {
      throw new HttpError(400, error.details.map(d => d.message).join(', '));
    }
    // req.user should be set by authMiddleware
    const result = await authService.upgradeGuest(req.user, value);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

const adminCreateUser = async (req, res, next) => {
  try {
    const newUser = await authService.adminCreateUser(req.body, req.user);
    res.status(201).json(newUser);
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
  resendVerificationOtp,
  createGuest,
  upgradeGuest,
};
