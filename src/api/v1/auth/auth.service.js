// File: src/api/v1/auth/auth.service.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const User = require('../../../models/user.model');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');
const { OAuth2Client } = require('google-auth-library');
const { sendEmail } = require('../../../services/email.service');

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

const requestPasswordReset = async (email) => {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      logger.warn(`Password reset requested for non-existent email: ${email}.`);
      return { message: 'If your email is registered, you will receive a password reset link.' };
    }
    const resetToken = crypto.randomBytes(32).toString('hex');
    user.passwordResetToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    user.passwordResetExpires = Date.now() + 3600000;
    await user.save();
    logger.info(`Password Reset Token for ${email}: ${resetToken}`);

    // FIX: Send the email with the reset link
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`; // Customize with your frontend URL
    await sendEmail({
      to: email,
      subject: 'Gas2Door Password Reset',
      text: `You requested a password reset. Click this link to reset your password: ${resetUrl}. If you didn't request this, ignore this email.`,
      html: `<p>You requested a password reset. Click <a href="${resetUrl}">this link</a> to reset your password. If you didn't request this, ignore this email.</p>`,
    });

    return { message: 'If your email is registered, you will receive a password reset link.' };
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
  resetPassword,
};