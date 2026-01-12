// File: src/api/v1/auth/auth.service.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const User = require('../../../models/user.model');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');
const globalConfig = require('../../../config'); // IMPORTANT: align JWT secret with auth.middleware.js
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

// ====================== GUEST + RESEND THROTTLE (CLINICAL ADD) ======================
const VERIFICATION_RESEND_COOLDOWN_SECONDS = Number(process.env.VERIFICATION_RESEND_COOLDOWN_SECONDS || 60);
const resendOtpThrottle = new Map();

const isGuestEmail = (email) =>
  typeof email === 'string' &&
  (email.endsWith('@guest.gas2door.ng') || email.endsWith('@guest.gas2door.local') || email.includes('@guest.'));

const makeGuestEmail = (phone) => {
  const suffix = uuidv4().slice(0, 8);
  const safePhone = String(phone || '').replace(/[^\d+]/g, '') || 'unknown';
  return `${safePhone}.${suffix}@guest.gas2door.ng`;
};

const makeGuestPassword = () => {
  // Plain string; user.model pre-save hook hashes it.
  return `G2D_g_${crypto.randomBytes(16).toString('hex')}`;
};

/**
 * CREATE GUEST SESSION (schema-safe)
 * - role MUST be a valid enum -> use 'customer'
 * - password MUST exist (schema requires it) -> random password
 * - isVerified MUST be true so nothing blocks order flow
 * - status active
 * - mark "guestness" via email domain @guest.gas2door.ng
 */
const createGuest = async (meta = {}) => {
  const name = (meta.name || 'Guest').toString().trim() || 'Guest';
  const phone = String(meta.phone || '').trim();

  if (!phone) throw new HttpError(400, 'Phone number is required to continue as a guest.');

  const guestUser = new User({
    id: uuidv4(),
    name,
    email: makeGuestEmail(phone),
    phone,
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
  const { email, password, name, phone } = upgradeData;

  const guest = await User.findOne({ id: guestUserId }).select('+isVerified +status +role +email');
  if (!guest) throw new HttpError(404, 'Guest session not found.');

  // Only allow upgrade for guest-marked emails
  if (!isGuestEmail(guest.email)) {
    throw new HttpError(400, 'Only guest checkout sessions can be upgraded.');
  }

  const emailLower = String(email || '').toLowerCase().trim();
  if (!emailLower) throw new HttpError(400, 'Email is required.');
  if (!password) throw new HttpError(400, 'Password is required.');

  // Prevent upgrading into an already-verified account
  const existing = await User.findOne({ email: emailLower }).select('+isVerified +id');
  if (existing && existing.isVerified && existing.id !== guest.id) {
    throw new HttpError(409, 'An account with this email already exists.');
  }
  if (existing && existing.id !== guest.id) {
    // No auto-merge here (safer)
    throw new HttpError(409, 'This email is already associated with another account.');
  }

  // OTP for email verification
  const otp = Math.floor(1000 + Math.random() * 9000).toString();
  const hashedOtp = await bcrypt.hash(otp, 10);
  const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

  guest.name = name || guest.name || 'Customer';
  guest.email = emailLower;
  guest.phone = phone || guest.phone || null;

  // IMPORTANT: assign plain password, rely on user.model pre-save hashing
  guest.password = password;
  guest.role = 'customer';
  guest.isVerified = false;
  guest.status = 'pending_verification';
  guest.otp = hashedOtp;
  guest.otpExpires = otpExpires;

  await guest.save();

  await sendEmail({
    to: emailLower,
    subject: 'Your Gas2Door Verification Code',
    text: `Your verification code is: ${otp}.`,
    html: `<p>Your verification code is: <strong>${otp}</strong>.</p>`
  });

  logger.info(`[AUTH_SERVICE] Upgrade OTP for ${emailLower}: ${otp}`);

  return {
    userId: guest.id,
    message: 'Upgrade successful. A 4-digit verification code has been sent to your email.'
  };
};

const resendVerificationOtp = async (email) => {
  const emailLower = String(email || '').toLowerCase().trim();
  if (!emailLower) throw new HttpError(400, 'Email is required.');

  const user = await User.findOne({ email: emailLower }).select('+isVerified +otp +otpExpires');
  if (!user) {
    // avoid account enumeration
    return { message: 'If your email is registered, a verification code will be sent.' };
  }

  if (user.isVerified) {
    return { message: 'Email is already verified.' };
  }

  const now = Date.now();
  const last = resendOtpThrottle.get(emailLower) || 0;
  const cooldownMs = VERIFICATION_RESEND_COOLDOWN_SECONDS * 1000;

  if (now - last < cooldownMs) {
    const waitSec = Math.ceil((cooldownMs - (now - last)) / 1000);
    throw new HttpError(429, `Please wait ${waitSec}s before requesting another code.`);
  }

  const otp = Math.floor(1000 + Math.random() * 9000).toString();
  user.otp = await bcrypt.hash(otp, 10);
  user.otpExpires = new Date(Date.now() + 10 * 60 * 1000);
  await user.save();

  resendOtpThrottle.set(emailLower, now);

  await sendEmail({
    to: emailLower,
    subject: 'Your Gas2Door Verification Code',
    text: `Your verification code is: ${otp}.`,
    html: `<p>Your verification code is: <strong>${otp}</strong>.</p>`
  });

  logger.info(`[AUTH_SERVICE] Resent OTP for ${emailLower}: ${otp}`);
  return { message: 'A new verification code has been sent to your email.' };
};
// ====================== END GUEST + RESEND THROTTLE (CLINICAL ADD) ======================

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
    password: password, // plain (user.model hashes)
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

  // Block password login for guest-marked accounts (safety)
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
