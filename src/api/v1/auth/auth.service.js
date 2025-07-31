// File: src/api/v1/auth/auth.service.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const User = require('../../../models/user.model');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');

// ========================== FIX IS HERE (1 of 3) ==========================
// Correctly import the OAuth2Client from the google-auth-library package.
const { OAuth2Client } = require('google-auth-library');
// The email service should be in the utils folder.
const { sendEmail } = require('../../../services/email.service'); 
// ========================================================================

const JWT_SECRET = process.env.JWT_SECRET || 'your-default-super-secret-key-for-dev';
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const generateJwtForUser = (user, isNewUser = false) => {
  const payload = { id: user.id, role: user.role };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1d' });
  return { 
    token, 
    userId: user.id, 
    role: user.role, 
    name: user.name,
    isNewUser, // Signal to the frontend if this is a first-time social login
    message: 'Login successful.' 
  };
};
const registerCustomer = async (userData) => {
    // This function is correct from your file, included for completeness.
    const { email, password, name, phone } = userData;
    const existingUser = await User.findOne({ email: email.toLowerCase() }).select('+isVerified');
    if (existingUser && existingUser.isVerified) {
        throw new HttpError(409, 'An account with this email already exists.');
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    const hashedOtp = await bcrypt.hash(otp, 10);
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000);
    const userFields = { name, email: email.toLowerCase(), phone, password: hashedPassword, role: 'customer', otp: hashedOtp, otpExpires, isVerified: false, status: 'pending_verification' };
    let user;
    if (existingUser) {
        user = await User.findOneAndUpdate({ _id: existingUser._id }, userFields, { new: true });
    } else {
        user = new User({ ...userFields, id: uuidv4() });
        await user.save();
    }
    await sendEmail({ to: email, subject: 'Your Gas2Door Verification Code', text: `Your verification code is: ${otp}.`, html: `<p>Your verification code is: <strong>${otp}</strong>.</p>` });
    logger.info(`[AUTH_SERVICE] OTP for ${email}: ${otp}`);
    return { userId: user.id, message: 'Registration successful. A 4-digit verification code has been sent to your email.' };
};

const verifyGoogleIdTokenAndLogin = async (idToken) => {
  try {
    const ticket = await client.verifyIdToken({
        idToken,
        audience: [
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_ANDROID_CLIENT_ID,
            process.env.GOOGLE_IOS_CLIENT_ID
        ].filter(id => id),
    });
    
    const payload = ticket.getPayload();
    const { email, name, sub: googleId } = payload;
    let user = await User.findOne({ email: email });

    if (user) {
      if (!user.googleId) {
        user.googleId = googleId;
        await user.save();
      }
      // It's an existing user
      return generateJwtForUser(user, false);
    } else {
      // It's a new user
      const newUser = new User({
        id: uuidv4(),
        googleId,
        name,
        email,
        phone: '00000000000', // Still a placeholder, will be updated by user
        role: 'customer',
        isVerified: true,
        status: 'active',
      });
      await newUser.save();
      // Pass 'true' to signal this is a new user
      return generateJwtForUser(newUser, true);
    }
  } catch (error) {
    logger.error("Error verifying Google ID token:", error);
    throw new HttpError(401, 'Invalid Google token or user could not be processed.');
  }
};

// ========================== FIX IS HERE (3 of 3) ==========================
// All other functions from your existing auth.service.js are included here
// to provide a single, complete, and correct file.
const verifyEmailOtp = async (email, otp) => {
    const user = await User.findOne({ 
      email: email.toLowerCase(),
      otpExpires: { $gt: Date.now() }
    }).select('+otp +isVerified');
  
    if (!user) {
      throw new HttpError(400, 'Verification code is invalid or has expired.');
    }
  
    const isMatch = await bcrypt.compare(otp, user.otp);
    if (!isMatch) {
      throw new HttpError(400, 'Invalid verification code provided.');
    }
  
    user.isVerified = true;
    user.status = 'active';
    user.otp = undefined;
    user.otpExpires = undefined;
    await user.save();
  
    return { message: 'Email verified successfully. You can now log in.' };
};

const login = async (email, password) => {
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password +isVerified');
    if (!user) {
      throw new HttpError(401, 'Invalid email or password.');
    }
    
    if (user.role === 'customer' && user.isVerified === false) {
      throw new HttpError(403, 'Your account has not been verified. Please check your email for the verification code.');
    }
    
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      throw new HttpError(401, 'Invalid email or password.');
    }
    
    return generateJwtForUser(user);
};

// =======================================================================
// MODIFIED: This function now generates a 6-digit numeric code.
// =======================================================================
const requestPasswordReset = async (email) => {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      logger.warn(`Password reset requested for non-existent email: ${email}.`);
      // Security best practice: Don't reveal if the email exists.
      return { message: 'If your email is registered, you will receive a 6-digit reset code.' };
    }
    
    // Generate a 6-digit numeric token
    const resetToken = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Store the HASH of the token, not the token itself
    user.passwordResetToken = await bcrypt.hash(resetToken, 10);
    // Set a short expiry (e.g., 10 minutes)
    user.passwordResetExpires = Date.now() + 10 * 60 * 1000; 
    await user.save();
    
    // Send the plain text token to the user's email
    await sendEmail({
      to: email,
      subject: 'Your Gas2Door Password Reset Code',
      text: `Your password reset code is: ${resetToken}. It will expire in 10 minutes.`,
      html: `<p>Your password reset code is: <strong>${resetToken}</strong>. It will expire in 10 minutes.</p>`
    });

    logger.info(`Password Reset Code for ${email}: ${resetToken}`);
    return { message: 'A 6-digit reset code has been sent to your email.' };
};

// =======================================================================
// NEW: This function verifies the 6-digit code and issues a secure, single-use token.
// =======================================================================
const verifyPasswordResetToken = async (email, token) => {
    const user = await User.findOne({ 
      email: email.toLowerCase(),
      passwordResetExpires: { $gt: Date.now() }
    }).select('+passwordResetToken');
  
    if (!user) {
      throw new HttpError(400, 'Reset code is invalid or has expired.');
    }
  
    const isMatch = await bcrypt.compare(token, user.passwordResetToken);
    if (!isMatch) {
      throw new HttpError(400, 'Invalid reset code provided.');
    }

    // The 6-digit code is valid. Now, create a new, more secure, single-use token for the final reset step.
    const finalResetToken = crypto.randomBytes(32).toString('hex');
    user.passwordResetToken = crypto.createHash('sha256').update(finalResetToken).digest('hex');
    // Extend expiry slightly for the user to enter their new password
    user.passwordResetExpires = Date.now() + 10 * 60 * 1000; 
    await user.save();

    // Send the secure token back to the frontend
    return { 
      message: 'Code verified successfully.',
      resetToken: finalResetToken 
    };
};

const resetPassword = async (token, newPassword) => {
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: Date.now() },
    });
    if (!user) {
      throw new HttpError(400, 'Password reset token is invalid or has expired.');
    }
    user.password = await bcrypt.hash(newPassword, 10);
    user.passwordResetToken = undefined;
    user.passwordResetExpires = null;
    await user.save();
    return { message: 'Password has been reset successfully.' };
};

module.exports = {
  registerCustomer,
  verifyGoogleIdTokenAndLogin,
  verifyEmailOtp,
  login,
  requestPasswordReset,
  verifyPasswordResetToken,
  resetPassword,
};