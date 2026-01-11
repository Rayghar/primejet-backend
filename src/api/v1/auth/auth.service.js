// File: src/api/v1/auth/auth.service.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const User = require('../../../models/user.model');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');
const referralService = require('../referrals/referral.service');
const { OAuth2Client } = require('google-auth-library');
const { sendEmail } = require('../../../services/email.service'); 
const Agent = require('../../../models/agent.model');
const agentService = require('../agents/agent.service');
const jwksClient = require('jwks-rsa'); // <<< --- ADD THIS LINE --- <<<

const JWT_SECRET = process.env.JWT_SECRET || 'your-default-super-secret-key-for-dev';
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

async function createGuest({ name, phone }) {
  if (!phone) {
    throw new HttpError(400, 'Phone number is required for guest checkout.');
  }

  // Reuse guest if phone already exists
  let user = await User.findOne({ phone });

  if (!user) {
    user = await User.create({
      id: uuidv4(),
      name: name || 'Guest Customer',
      phone,
      role: 'guest',
      status: 'active',
      isVerified: true,              // 👈 IMPORTANT
      createdVia: 'guest_checkout',
    });
  }

  const token = jwt.sign(
    { id: user.id, role: user.role },
    config.jwt.secret,
    { expiresIn: '30d' }
  );

  return {
    user,
    token,
  };
}

const registerCustomer = async (userData) => {
    const { email, password, name, phone, referralCode } = userData;
    const existingUser = await User.findOne({ email: email.toLowerCase() }).select('+isVerified');
    if (existingUser && existingUser.isVerified) {
        throw new HttpError(409, 'An account with this email already exists.');
    }

    // ============================= FIX IS HERE =============================
    // The password is now passed directly to the user model.
    // The pre-save hook in user.model.js will handle hashing it ONCE before saving.
    // This prevents the double-hashing bug.
    // const hashedPassword = await bcrypt.hash(password, 10); // REMOVED
    // =====================================================================
    const hashedPassword = await bcrypt.hash(password, 10);
    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    const hashedOtp = await bcrypt.hash(otp, 10);
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000);
    
    // Pass the plain password to the userFields object.
    const userFields = { name, email: email.toLowerCase(), phone, password: password, role: 'customer', otp: hashedOtp, otpExpires, isVerified: false, status: 'pending_verification' };
    
    let user;
    if (existingUser) {
        user = await User.findOneAndUpdate({ _id: existingUser._id }, userFields, { new: true });
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
            logger.info(`[AUTH_SERVICE] Attributing new user ${email} to agent ${potentialAgent.id} via code ${trimmedCode}.`);
        } else {
            // 2. If not an agent, fallback to the customer-to-customer referral logic.
            logger.info(`[AUTH_SERVICE] Code ${trimmedCode} not found for an active agent. Checking for customer referral.`);
            await referralService.processCodeOnRegistration(user, trimmedCode);
        }
    }
    // =================== MODIFICATION END: Unified Referral Code Logic ===================

    await user.save();

    // ================== MODIFICATION START: Update Agent Stats After User is Saved ==================
    // If the user was linked to an agent, mark the registration event to update agent stats.
    if (user.referredByAgentId) {
        // This call updates the agent's total and logs the event.
        await agentService.markCustomerRegisteredByAgent(referralCode.trim().toUpperCase(), user.id);
    }
    // =================== MODIFICATION END: Update Agent Stats After User is Saved ===================

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
      return generateJwtForUser(user, false);
    } else {
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
    }
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
    if (!decodedToken) {
      throw new HttpError(401, 'Invalid Apple ID Token format.');
    }

    const { kid } = decodedToken.header;
    // 1. Fetch Apple's public key that corresponds to the token's kid
    const key = await appleClient.getSigningKey(kid);
    const publicKey = key.getPublicKey();
    
    // 2. Verify the ID Token's signature and claims
    const payload = jwt.verify(idToken, publicKey, {
      algorithms: ['RS256', 'ES256'],
      issuer: 'https://appleid.apple.com',
      audience: APPLE_AUDIENCE, // Check against your Services ID
      // NOTE: The nonce is omitted here, but is required for production security
      // ignoreNonce: true 
    });

    const { email, sub: appleId } = payload;
    let user = await User.findOne({ appleId }).select('+isVerified +status');
    let isNewUser = false;
    
    // Handle user creation or linking
    if (!user) {
        // Fallback: Check if the user exists by email (for linking accounts)
        user = await User.findOne({ email: email.toLowerCase() }).select('+isVerified +status');

        if (user) {
            // Found existing user by email, link the Apple ID
            user.appleId = appleId;
            user.isVerified = true; 
            if (user.status === 'pending_verification') user.status = 'active';
            await user.save();
        } else {
            // New user, create new account
            const newUser = new User({
                id: uuidv4(),
                appleId,
                name: payload.name || 'Apple User', // Try to use the name if provided in payload
                email: email.toLowerCase(),
                phone: null, // Phone is optional for social sign-ins
                role: 'customer',
                isVerified: true,
                status: 'active',
                password: null, // CRITICAL: Must be null to signal social login
            });
            await newUser.save();
            user = newUser;
            isNewUser = true;
        }
    } else {
      // Existing user signed in with Apple ID
      isNewUser = false;
    }
    
    // Return a standard login response
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

// File: src/api/v1/auth/auth.service.js

const login = async (email, password) => {
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password +isVerified');
    if (!user) {
        throw new HttpError(401, 'Invalid email or password.');
    }

    // ============================= FIX IS HERE =============================
    // Check if a password is not set, which implies a social login.
    if (!user.password) {
        throw new HttpError(403, 'This account was created using a social provider. Please use Google Sign-In.');
    }
    // =====================================================================
    
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
  // This check is now robust. It uses the user object that the middleware already verified.
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
    role: role || 'customer', // Default to 'customer' if role not provided
    isVerified: true, // Users created by admins are verified by default
    status: 'active',
  });

  await newUser.save();
  
  // Return a clean version of the user object, without the password.
  const userJson = newUser.toJSON();
  delete userJson.password;

  return userJson;
};

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

    const finalResetToken = crypto.randomBytes(32).toString('hex');
    user.passwordResetToken = crypto.createHash('sha256').update(finalResetToken).digest('hex');
    user.passwordResetExpires = Date.now() + 10 * 60 * 1000; 
    await user.save();

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
  createGuest,

};