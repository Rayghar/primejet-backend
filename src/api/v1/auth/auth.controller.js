// File: src/api/v1/auth/auth.controller.js
const authService = require('./auth.service');
const authValidation = require('./auth.validation');
const HttpError = require('../../../utils/HttpError');


const registerAdmin = async (req, res, next) => {
  try {
    // Step 1: Validate request body inside the controller
    const { error, value } = authValidation.registerAdminSchema.validate(req.body);
    if (error) {
      throw new HttpError(400, error.details.map(d => d.message).join(', '));
    }
    // Step 2: Call the service with the validated data
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

// ========================== FIX IS HERE ==========================
// This function was missing, causing the "argument handler must be a function" error.
const verifyEmailOtp = async (req, res, next) => {
  try {
    const { email, otp } = req.body;
    const result = await authService.verifyEmailOtp(email, otp);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

const resendOtp = async (req, res, next) => {
    try {
        const { email } = req.body;
        // In a real app, you would have a dedicated resend service.
        // For now, re-running register will generate and send a new OTP.
        const result = await authService.registerCustomer({ email, ...req.body });
        res.status(200).json({ message: 'A new verification code has been sent.' });
    } catch (error) {
        next(error);
    }
};
// ===============================================================

const verifyPasswordResetToken = async (req, res, next) => {
  try {
    const { email, token } = req.body;
    const result = await authService.verifyPasswordResetToken(email, token);
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

module.exports = {
  registerCustomer,
  registerDriver,
  registerAdmin,
  googleMobileSignIn,
  login,
  requestPasswordReset,
  resetPassword,
  verifyEmailOtp,
  resendOtp, // Added resendOtp function
};