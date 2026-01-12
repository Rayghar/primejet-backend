// File: src/api/v1/auth/auth.service.js
// NOTE: Clinical update only (guest session + upgrade + resend verification throttle + JWT secret alignment)

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const User = require('../../../models/user.model');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');
const globalConfig = require('../../../config'); // aligns JWT secret with auth.middleware.js
const referralService = require('../referrals/referral.service');
const { OAuth2Client } = require('google-auth-library');
const { sendEmail } = require('../../../services/email.service');
const Agent = require('../../../models/agent.model');
const agentService = require('../agents/agent.service');
const jwksClient = require('jwks-rsa');

const JWT_SECRET =
  (globalConfig && globalConfig.jwt && globalConfig.jwt.secret) ||
  process.env.JWT_SECRET ||
  'fallback_super_secret_key_for_dev_only_please_change';

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
    message: 'Login successful.',
  };
};

// ====================== GUEST + RESEND THROTTLE (SURGICAL ADD) ======================
const VERIFICATION_RESEND_COOLDOWN_SECONDS = Number(
  process.env.VERIFICATION_RESEND_COOLDOWN_SECONDS || 60
);

// In-memory throttle: key=emailLower, value=timestamp(ms)
// (No DB/model changes; resets on restart which is acceptable for throttle)
const resendOtpThrottle = new Map();

const makeGuestEmail = () => `guest_${uuidv4()}@guest.gas2door.local`;

/**
 * Create a "guest checkout" session.
 * IMPORTANT: role is set to 'customer' so existing order routes protected by authMiddleware('customer') work unchanged.
 * We use a synthetic guest email domain + password null to distinguish guest accounts.
 */
const createGuest = async (meta = {}) => {
  const guestUser = new User({
    id: uuidv4(),
    name: meta.name || 'Guest',
    email: makeGuestEmail(),
    phone: meta.phone || null,
    role: 'customer', // critical for existing protected routes
    isVerified: true, // avoid verification block for guest checkout
    status: 'active',
    password: null, // signals non-password account; do not use /login
  });

  await guestUser.save();

  const jwtPayload = generateJwtForUser(guestUser, true);
  return {
    ...jwtPayload,
    isGuest: true,
  };
};

/**
 * Upgrade a guest checkout session into a real customer account.
 * Accepts either:
 *  - guestUserOrId: string (user.id) OR
 *  - guestUserOrId: req.user object (must have id)
 */
const upgradeGuest = async (guestUserOrId, upgradeData) => {
  const guestUserId =
    typeof guestUserOrId === 'string' ? guestUserOrId : guestUserOrId?.id;

  if (!guestUserId) throw new HttpError(401, 'Authentication required.');

  const { email, password, name } = upgradeData;

  const guest = await User.findOne({ id: guestUserId }).select(
    '+isVerified +status +role +password +otp +otpExpires'
  );

  if (!guest) throw new HttpError(404, 'Guest account not found.');

  // Identify "guest checkout" accounts safely without changing schema:
  // - password must be null AND
  // - email must be within the synthetic guest domain
  const isGuestAccount =
    !guest.password &&
    typeof guest.email === 'string' &&
    guest.email.endsWith('@guest.gas2door.local');

  if (!isGuestAccount) {
    throw new HttpError(400, 'Only guest checkout sessions can be upgraded.');
  }

  const emailLower = email.toLowerCase();

  // Prevent upgrading into an already-verified account
  const existing = await User.findOne({ email: emailLower }).select(
    '+isVerified +role +id'
  );

  if (existing && existing.isVerified) {
    throw new HttpError(409, 'An account with this email already exists.');
  }

  // Don’t auto-merge into another account (keep clinical/safe)
  if (existing && existing.id !== guest.id) {
    throw new HttpError(409, 'This email is already associated with another account.');
  }

  // Generate OTP for email verification
  const otp = Math.floor(1000 + Math.random() * 9000).toString();
  const hashedOtp = await bcrypt.hash(otp, 10);
  const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

  // IMPORTANT: keep consistent with your current design:
  // pass plain password and rely on user.model.js pre-save hook to hash once
  guest.name = name || guest.name || 'Customer';
  guest.email = emailLower;
  guest.password = password; // plain
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
    html: `<p>Your verification code is: <strong>${otp}</strong>.</p>`,
  });

  logger.info(`[AUTH_SERVICE] Upgrade OTP for ${emailLower}: ${otp}`);

  // Return a clean response (optionally include token if your frontend wants it)
  const jwtPayload = generateJwtForUser(guest, false);
  return {
    ...jwtPayload,
    message:
      'Upgrade successful. A 4-digit verification code has been sent to your email.',
    isGuest: false,
    requiresVerification: true,
  };
};

const resendVerificationOtp = async (email) => {
  const emailLower = email.toLowerCase();

  const user = await User.findOne({ email: emailLower }).select(
    '+isVerified +otp +otpExpires'
  );

  // avoid account enumeration
  if (!user) {
    return { message: 'If your email is registered, a verification code will be sent.' };
  }

  if (user.isVerified) {
    return { message: 'Email is already verified.' };
  }

  // Throttle
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
    html: `<p>Your verification code is: <strong>${otp}</strong>.</p>`,
  });

  logger.info(`[AUTH_SERVICE] Resent OTP for ${emailLower}: ${otp}`);

  return { message: 'A new verification code has been sent to your email.' };
};
// ====================== END GUEST + RESEND THROTTLE (SURGICAL ADD) ======================

const registerCustomer = async (userData) => {
  const { email, password, name, phone, referralCode } = userData;

  const existingUser = await User.findOne({ email: email.toLowerCase() }).select(
    '+isVerified'
  );

  if (existingUser && existingUser.isVerified) {
    throw new HttpError(409, 'An account with this email already exists.');
  }

  // IMPORTANT: do NOT hash here (pre-save hook in user.model.js should hash once)
  const otp = Math.floor(1000 + Math.random() * 9000).toString();
  const hashedOtp = await bcrypt.hash(otp, 10);
  const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

  const userFields = {
    name,
    email: email.toLowerCase(),
    phone,
    password: password, // plain; model hook hashes
    role: 'customer',
    otp: hashedOtp,
    otpExpires,
    isVerified: false,
    status: 'pending_verification',
  };

  let user;
  if (existingUser) {
    user = await User.findOneAndUpdate({ _id: existingUser._id }, userFields, {
      new: true,
    });
  } else {
    user = new User({ ...userFields, id: uuidv4() });
    await user.save();
  }

  if (referralCode && referralCode.trim().length > 0) {
    const trimmedCode = referralCode.trim().toUpperCase();

    // 1. Check if the code belongs to an active agent first.
    const potentialAgent = await Agent.findOne({ agentCode: trimmedCode });

    if (potentialAgent && potentialAgent.isActive) {
      // It's an agent referral. Link the user to the agent.
      user.referredByAgentId = potentialAgent.id;
      logger.info(
        `[AUTH_SERVICE] Attributing new user ${email} to agent ${potentialAgent.id} via code ${trimmedCode}.`
      );
    } else {
      // 2. If not an agent, fallback to the customer-to-customer referral logic.
      logger.info(
        `[AUTH_SERVICE] Code ${trimmedCode} not found for an active agent. Checking for customer referral.`
      );
      await referralService.processCodeOnRegistration(user, trimmedCode);
    }
  }

  await user.save();

  // Update agent stats after user is saved
  if (user.referredByAgentId) {
    await agentService.markCustomerRegisteredByAgent(
      referralCode.trim().toUpperCase(),
      user.id
    );
  }

  await sendEmail({
    to: email,
    subject: 'Your Gas2Door Verification Code',
    text: `Your verification code is: ${otp}.`,
    html: `<p>Your verification code is: <strong>${otp}</strong>.</p>`,
  });

  logger.info(`[AUTH_SERVICE] OTP for ${email}: ${otp}`);

  return {
    userId: user.id,
    message:
      'Registration successful. A 4-digit verification code has been sent to your email.',
  };
};

const verifyGoogleIdTokenAndLogin = async (idToken) => {
  try {
    const ticket = await client.verifyIdToken({
      idToken,
      audience: [
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_ANDROID_CLIENT_ID,
        process.env.GOOGLE_IOS_CLIENT_ID,
      ].filter((id) => id),
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
    logger.error('Error verifying Google ID token:', error);
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
    if (!decodedToken) {
      throw new HttpError(401, 'Invalid Apple ID Token format.');
    }

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
    } else {
      isNewUser = false;
    }

    return generateJwtForUser(user, isNewUser);
  } catch (error) {
    logger.error('Error verifying Apple ID token:', error.message, { stack: error.stack });
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      throw new HttpError(401, `Invalid Apple Token: ${error.message}`);
    }
    throw new HttpError(500, 'Apple Sign-In failed due to server error.');
  }
};

const verifyEmailOtp = async (email, otp) => {
  const user = await User.findOne({
    email: email.toLowerCase(),
    otpExpires: { $gt: Date.now() },
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
  const user = await User.findOne({ email: email.toLowerCase() }).select(
    '+password +isVerified'
  );

  if (!user) {
    throw new HttpError(401, 'Invalid email or password.');
  }

  // If a password is not set, this implies a social login OR guest checkout account.
  if (!user.password) {
    // Keep original behavior, but make message safer for guest/social
    throw new HttpError(
      403,
      'This account cannot use password login. Please use the appropriate sign-in method.'
    );
  }

  if (user.role === 'customer' && user.isVerified === false) {
    throw new HttpError(
      403,
      'Your account has not been verified. Please check your email for the verification code.'
    );
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
    html: `<p>Your password reset code is: <strong>${resetToken}</strong>. It will expire in 10 minutes.</p>`,
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
  if (existingUser) {
    throw new HttpError(409, 'An account with this email already exists.');
  }

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
    passwordResetExpires: { $gt: Date.now() },
  }).select('+passwordResetToken');

  if (!user) {
    throw new HttpError(400, 'Reset code is invalid or has expired.');
  }

  const isMatch = await bcrypt.compare(token, user.passwordResetToken);
  if (!isMatch) {
    throw new HttpError(400, 'Invalid reset code provided.');
  }

  const finalResetToken = crypto.randomBytes(32).toString('hex');
  user.passwordResetToken = crypto.createHash('sha256').update(finalResetToken).digest('hex');
  user.passwordResetExpires = Date.now() + 10 * 60 * 1000;
  await user.save();

  return {
    message: 'Code verified successfully.',
    resetToken: finalResetToken,
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

  user.password = newPassword;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;

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
  adminCreateUser,
  verifyAppleIdTokenAndLogin,

  // --- surgical add ---
  createGuest,
  upgradeGuest,
  resendVerificationOtp,
};
