// File: src/api/v1/auth/auth.service.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const User = require('../../../models/user.model');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');
const globalConfig = require('../../../config');
const referralService = require('../referrals/referral.service');
const { OAuth2Client } = require('google-auth-library');
const { sendEmail } = require('../../../services/email.service');
const Agent = require('../../../models/agent.model');
const agentService = require('../agents/agent.service');
const jwksClient = require('jwks-rsa');

const JWT_SECRET = (globalConfig && globalConfig.jwt && globalConfig.jwt.secret)
  ? globalConfig.jwt.secret
  : (process.env.JWT_SECRET || 'your-default-super-secret-key-for-dev');

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const APPLE_AUDIENCE = process.env.APPLE_SERVICE_ID;

const appleClient = jwksClient({
  jwksUri: 'https://appleid.apple.com/auth/keys',
});

// --- [TRACE FIX] SAFE EMAIL SENDER ---
// Prevents the server from hanging for 3 minutes if SMTP is blocked/slow.
const sendEmailSafely = async (emailOptions) => {
    logger.info(`[TRACE] Sending email to: ${emailOptions.to}`);
    
    const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Email server timed out (8s limit)")), 8000)
    );

    try {
        await Promise.race([sendEmail(emailOptions), timeout]);
        logger.info(`[TRACE] Email sent successfully.`);
    } catch (e) {
        logger.error(`[TRACE] Email Failed: ${e.message}`);
        throw new HttpError(503, "Verification email failed to send. Please try again or contact support.");
    }
};

// ✅ NEW: Background (fire-and-forget) email sender for upgradeGuest only
// This prevents the upgrade endpoint from hanging indefinitely when SendGrid is slow/blocked.
const sendEmailBackground = (emailOptions) => {
  // Detach completely from current execution context
  setImmediate(() => {
    sendEmail(emailOptions)
      .then(() => {
        logger.info(`[AUTH_SERVICE] Verification email successfully sent to ${emailOptions.to}`);
      })
      .catch((err) => {
        logger.error(`[AUTH_SERVICE] Failed to send verification email to ${emailOptions.to}:`, {
          message: err.message,
          stack: err.stack,
        });
      });
  });
};

const generateJwtForUser = (user, isNewUser = false) => {
  const payload = { id: user.id, role: user.role };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1d' });
  return {
    token,
    userId: user.id,
    role: user.role,
    name: user.name,
    isNewUser,
    message: 'Login successful.'
  };
};

const VERIFICATION_RESEND_COOLDOWN_SECONDS = Number(process.env.VERIFICATION_RESEND_COOLDOWN_SECONDS || 60);
const resendOtpThrottle = new Map();

const isGuestEmail = (email) =>
  typeof email === 'string' &&
  (email.endsWith('@guest.gas2door.ng') || email.endsWith('@guest.gas2door.local') || email.includes('@guest.'));

const makeGuestEmail = (phone) => {
  const safePhone = String(phone || '').replace(/[^\d+]/g, '') || 'unknown';
  return `${safePhone}@guest.gas2door.ng`;
};

const makeGuestPassword = () => {
  return `G2D_g_${crypto.randomBytes(16).toString('hex')}`;
};

const createGuest = async (meta = {}) => {
  const name = (meta.name || 'Guest').toString().trim() || 'Guest';
  const phone = String(meta.phone || '').trim();

  if (!phone) throw new HttpError(400, 'Phone number is required for guest checkout.');

  const safePhone = phone.replace(/[^\d+]/g, '');

  let guestUser = await User.findOne({ phone: safePhone });

  if (guestUser) {
    if (!isGuestEmail(guestUser.email)) {
        throw new HttpError(409, 'This phone number is already registered. Please log in.');
    }

    if (name !== 'Guest' && guestUser.name !== name) {
        guestUser.name = name;
        await guestUser.save();
    }

    const jwtResult = generateJwtForUser(guestUser, false);
    return {
        ...jwtResult,
        user: {
            id: guestUser.id,
            name: guestUser.name,
            role: guestUser.role,
            email: guestUser.email,
            phone: guestUser.phone,
            isGuest: true,
        }
    };
  }

  guestUser = new User({
    id: uuidv4(),
    name,
    email: makeGuestEmail(safePhone),
    phone: safePhone,
    password: makeGuestPassword(),
    role: 'customer',
    isVerified: true,
    status: 'active',
  });
  await guestUser.save();
  const jwtResult = generateJwtForUser(guestUser, true);
  return {
    ...jwtResult,
    user: {
      id: guestUser.id,
      name: guestUser.name,
      role: guestUser.role,
      email: guestUser.email,
      phone: guestUser.phone,
      isGuest: true,
    }
  };
};

const upgradeGuest = async (guestUserId, upgradeData) => {
  logger.info(`[UPGRADE_GUEST] STARTED for UserID: ${guestUserId} | Payload: ${JSON.stringify(upgradeData)}`);

  const { email, password, name } = upgradeData;
  const guest = await User.findOne({ id: guestUserId }).select('+isVerified +status +role +email');
  if (!guest) {
    logger.warn(`[UPGRADE_GUEST] Guest not found for ID: ${guestUserId}`);
    throw new HttpError(404, 'Guest session not found.');
  }
  if (!isGuestEmail(guest.email)) {
    logger.warn(`[UPGRADE_GUEST] Account already upgraded for ID: ${guestUserId}`);
    throw new HttpError(400, 'This account is already upgraded.');
  }

  const emailLower = String(email || '').toLowerCase().trim();
  if (!emailLower) throw new HttpError(400, 'Email is required.');
  if (!password) throw new HttpError(400, 'Password is required.');

  const existing = await User.findOne({ email: emailLower }).select('+id');
  if (existing && existing.id !== guest.id) {
    logger.warn(`[UPGRADE_GUEST] Email collision: ${emailLower} already exists`);
    throw new HttpError(409, 'An account with this email already exists.');
  }

  const otp = Math.floor(1000 + Math.random() * 9000).toString();
  const hashedOtp = await bcrypt.hash(otp, 10);
  const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

  // ✅ Explicitly hash password (consistent with adminCreateUser, avoids reliance on pre-save hook issues)
  const hashedPassword = await bcrypt.hash(password, 10);

  logger.info(`[UPGRADE_GUEST] Updating DB for UserID: ${guestUserId}`);

  guest.name = name || guest.name;
  guest.email = emailLower;
  guest.password = hashedPassword;
  guest.role = 'customer';
  guest.isVerified = false;
  guest.status = 'pending_verification';
  guest.otp = hashedOtp;
  guest.otpExpires = otpExpires;

  await guest.save();

  logger.info(`[UPGRADE_GUEST] DB update complete for UserID: ${guestUserId}. Queuing background email to ${emailLower}`);

  // ✅ NON-BLOCKING EMAIL (fire-and-forget with setImmediate for full detachment)
  sendEmailBackground({
    to: emailLower,
    subject: 'Gas2Door – Complete Your Account Upgrade',
    text: `Hello ${name || 'Customer'},\n\nYour account upgrade is almost complete!\nYour 4-digit verification code is: ${otp}\n\nIt expires in 10 minutes.\n\nIf you didn't request this, ignore this email.\n\nThank you,\nGas2Door Team`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
        <h2 style="color: #0d9488;">Gas2Door Account Upgrade</h2>
        <p>Hello <strong>${name || 'Customer'}</strong>,</p>
        <p>Your account upgrade is almost complete!</p>
        <p style="font-size: 1.2em;">Your verification code is:</p>
        <p style="font-size: 2em; font-weight: bold; color: #0d9488; letter-spacing: 8px;">${otp}</p>
        <p>It expires in <strong>10 minutes</strong>.</p>
        <p>If you did not request this upgrade, please ignore this email.</p>
        <p>Thank you,<br/><strong>Gas2Door Team</strong></p>
      </div>
    `,
  });

  logger.info(`[UPGRADE_GUEST] OTP (dev only): ${otp} | Returning success response immediately`);

  return {
    userId: guest.id,
    message: 'Account upgraded successfully! Please check your email for the 4-digit verification code. If you don\'t receive it within a few minutes, you can request a resend on the verification screen.'
  };
};

const resendVerificationOtp = async (email) => {
  const emailLower = String(email || '').toLowerCase().trim();
  logger.info(`[TRACE] Resending OTP to: ${emailLower}`);
  if (!emailLower) throw new HttpError(400, 'Email is required.');
  const user = await User.findOne({ email: emailLower }).select('+isVerified +otp +otpExpires');
  if (!user) return { message: 'If registered, code sent.' };
  if (user.isVerified) return { message: 'Email already verified.' };
  const now = Date.now();
  const last = resendOtpThrottle.get(emailLower) || 0;
  const cooldownMs = VERIFICATION_RESEND_COOLDOWN_SECONDS * 1000;
  if (now - last < cooldownMs) {
    throw new HttpError(429, `Please wait before requesting another code.`);
  }
  const otp = Math.floor(1000 + Math.random() * 9000).toString();
  user.otp = await bcrypt.hash(otp, 10);
  user.otpExpires = new Date(Date.now() + 10 * 60 * 1000);
  await user.save();
  resendOtpThrottle.set(emailLower, now);
  await sendEmailSafely({
    to: emailLower,
    subject: 'Gas2Door Verification Code',
    text: `Your verification code is: ${otp}.`,
    html: `<p>Your verification code is: <strong>${otp}</strong>.</p>`
  });
  return { message: 'Verification code sent.' };
};

// ====================== REMAINING FUNCTIONS UNCHANGED ======================

const registerCustomer = async (userData) => {
  const { email, password, name, phone, referralCode } = userData;
  const existingUser = await User.findOne({ email: email.toLowerCase() }).select('+isVerified');
  if (existingUser && existingUser.isVerified) {
    throw new HttpError(409, 'An account with this email already exists.');
  }
  const otp = Math.floor(1000 + Math.random() * 9000).toString();
  const hashedOtp = await bcrypt.hash(otp, 10);
  const otpExpires = new Date(Date.now() + 10 * 60 * 1000);
  const userFields = {
    name,
    email: email.toLowerCase(),
    phone,
    password: password,
    role: 'customer',
    otp: hashedOtp,
    otpExpires,
    isVerified: false,
    status: 'pending_verification'
  };
  let user;
  if (existingUser) {
    user = await User.findOneAndUpdate({ _id: existingUser._id }, userFields, { new: true });
  } else {
    user = new User({ ...userFields, id: uuidv4() });
    await user.save();
  }
  if (referralCode && referralCode.trim().length > 0) {
    const trimmedCode = referralCode.trim().toUpperCase();
    const potentialAgent = await Agent.findOne({ agentCode: trimmedCode });
    if (potentialAgent && potentialAgent.isActive) {
      user.referredByAgentId = potentialAgent.id;
      logger.info(`[AUTH_SERVICE] Attributing new user ${email} to agent ${potentialAgent.id} via code ${trimmedCode}.`);
    } else {
      logger.info(`[AUTH_SERVICE] Code ${trimmedCode} not found for an active agent. Checking for customer referral.`);
      await referralService.processCodeOnRegistration(user, trimmedCode);
    }
  }
  await user.save();
  if (user.referredByAgentId) {
    await agentService.markCustomerRegisteredByAgent(referralCode.trim().toUpperCase(), user.id);
  }
  await sendEmail({
    to: email,
    subject: 'Your Gas2Door Verification Code',
    text: `Your verification code is: ${otp}.`,
    html: `<p>Your verification code is: <strong>${otp}</strong>.</p>`
  });
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
      return generateJwtForUser(user, false);
    }
    const newUser = new User({
      id: uuidv4(),
      googleId,
      name,
      email,
      phone: '00000000000',
      role: 'customer',
      isVerified: true,
      status: 'active',
    });
    await newUser.save();
    return generateJwtForUser(newUser, true);
  } catch (error) {
    logger.error("Error verifying Google ID token:", error);
    throw new HttpError(401, 'Invalid Google token or user could not be processed.');
  }
};

const verifyAppleIdTokenAndLogin = async (idToken) => {
  if (!APPLE_AUDIENCE) {
    logger.error('APPLE_SERVICE_ID is not configured in ENV.');
    throw new HttpError(500, 'Server configuration error: Apple Sign-In not fully set up.');
  }
  try {
    const decodedToken = jwt.decode(idToken, { complete: true });
    if (!decodedToken) throw new HttpError(401, 'Invalid Apple ID Token format.');
    const { kid } = decodedToken.header;
    const key = await appleClient.getSigningKey(kid);
    const publicKey = key.getPublicKey();
    const payload = jwt.verify(idToken, publicKey, {
      algorithms: ['RS256', 'ES256'],
      issuer: 'https://appleid.apple.com',
      audience: APPLE_AUDIENCE,
    });
    const { email, sub: appleId } = payload;
    let user = await User.findOne({ appleId }).select('+isVerified +status');
    let isNewUser = false;
    if (!user) {
      user = await User.findOne({ email: email.toLowerCase() }).select('+isVerified +status');
      if (user) {
        user.appleId = appleId;
        user.isVerified = true;
        if (user.status === 'pending_verification') user.status = 'active';
        await user.save();
      } else {
        const newUser = new User({
          id: uuidv4(),
          appleId,
          name: payload.name || 'Apple User',
          email: email.toLowerCase(),
          phone: null,
          role: 'customer',
          isVerified: true,
          status: 'active',
          password: null,
        });
        await newUser.save();
        user = newUser;
        isNewUser = true;
      }
    }
    return generateJwtForUser(user, isNewUser);
  } catch (error) {
    logger.error("Error verifying Apple ID token:", error.message, { stack: error.stack });
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      throw new HttpError(401, `Invalid Apple Token: ${error.message}`);
    }
    throw new HttpError(500, 'Apple Sign-In failed due to server error.');
  }
};

const verifyEmailOtp = async (email, otp) => {
  const user = await User.findOne({
    email: email.toLowerCase(),
    otpExpires: { $gt: Date.now() }
  }).select('+otp +isVerified');
  if (!user) throw new HttpError(400, 'Verification code is invalid or has expired.');
  const isMatch = await bcrypt.compare(otp, user.otp);
  if (!isMatch) throw new HttpError(400, 'Invalid verification code provided.');
  user.isVerified = true;
  user.status = 'active';
  user.otp = undefined;
  user.otpExpires = undefined;
  await user.save();
  return { message: 'Email verified successfully. You can now log in.' };
};

const login = async (email, password) => {
  const user = await User.findOne({ email: email.toLowerCase() }).select('+password +isVerified');
  if (!user) throw new HttpError(401, 'Invalid email or password.');
  if (isGuestEmail(user.email)) {
    throw new HttpError(403, 'This is a guest checkout session. Please upgrade your account to log in.');
  }
  if (!user.password) {
    throw new HttpError(403, 'This account was created using a social provider. Please use Google Sign-In.');
  }
  if (user.role === 'customer' && user.isVerified === false) {
    throw new HttpError(403, 'Your account has not been verified. Please check your email for the verification code.');
  }
  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) throw new HttpError(401, 'Invalid email or password.');
  return generateJwtForUser(user);
};

const requestPasswordReset = async (email) => {
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) {
    logger.warn(`Password reset requested for non-existent email: ${email}.`);
    return { message: 'If your email is registered, you will receive a 6-digit reset code.' };
  }
  const resetToken = Math.floor(100000 + Math.random() * 900000).toString();
  user.passwordResetToken = await bcrypt.hash(resetToken, 10);
  user.passwordResetExpires = Date.now() + 10 * 60 * 1000;
  await user.save();
  await sendEmail({
    to: email,
    subject: 'Your Gas2Door Password Reset Code',
    text: `Your password reset code is: ${resetToken}. It will expire in 10 minutes.`,
    html: `<p>Your password reset code is: <strong>${resetToken}</strong>. It will expire in 10 minutes.</p>`
  });
  logger.info(`Password Reset Code for ${email}: ${resetToken}`);
  return { message: 'A 6-digit reset code has been sent to your email.' };
};

const adminCreateUser = async (newUserData, requestingUser) => {
  if (!requestingUser || requestingUser.role !== 'admin') {
    throw new HttpError(403, 'Insufficient permissions. Only admins can create new users.');
  }
  const { email, password, name, phone, role } = newUserData;
  const existingUser = await User.findOne({ email: email.toLowerCase() });
  if (existingUser) throw new HttpError(409, 'An account with this email already exists.');
  const hashedPassword = await bcrypt.hash(password, 10);
  const newUser = new User({
    id: uuidv4(),
    name,
    email: email.toLowerCase(),
    phone,
    password: hashedPassword,
    role: role || 'customer',
    isVerified: true,
    status: 'active',
  });
  await newUser.save();
  const userJson = newUser.toJSON();
  delete userJson.password;
  return userJson;
};

const verifyPasswordResetToken = async (email, token) => {
  const user = await User.findOne({
    email: email.toLowerCase(),
    passwordResetExpires: { $gt: Date.now() }
  }).select('+passwordResetToken');
  if (!user) throw new HttpError(400, 'Reset code is invalid or has expired.');
  const isMatch = await bcrypt.compare(token, user.passwordResetToken);
  if (!isMatch) throw new HttpError(400, 'Invalid reset code provided.');
  const finalResetToken = crypto.randomBytes(32).toString('hex');
  user.passwordResetToken = crypto.createHash('sha256').update(finalResetToken).digest('hex');
  user.passwordResetExpires = Date.now() + 10 * 60 * 1000;
  await user.save();
  return { message: 'Code verified successfully.', resetToken: finalResetToken };
};

const resetPassword = async (token, newPassword) => {
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() },
  });
  if (!user) throw new HttpError(400, 'Password reset token is invalid or has expired.');
  user.password = newPassword;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  await user.save();
  return { message: 'Password has been reset successfully.' };
};

module.exports = {
  registerCustomer,
  verifyGoogleIdTokenAndLogin,
  verifyAppleIdTokenAndLogin,
  verifyEmailOtp,
  login,
  requestPasswordReset,
  verifyPasswordResetToken,
  resetPassword,
  adminCreateUser,

  // guest flow
  createGuest,
  upgradeGuest,
  resendVerificationOtp,
};