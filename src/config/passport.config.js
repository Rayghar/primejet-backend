// File: src/config/passport.config.js
const passport = require('passport');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/user.model');
const { v4: uuidv4 } = require('uuid');

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// This function will be the core of our mobile sign-in service
async function findOrCreateGoogleUser(payload) {
  const { email, name, sub: googleId } = payload;
  let user = await User.findOne({ email: email });

  if (user) {
    // If user exists, optionally update their googleId if not present
    if (!user.googleId) {
      user.googleId = googleId;
      await user.save();
    }
    return user;
  } else {
    // User does not exist, create a new one
    const newUser = new User({
      id: uuidv4(),
      googleId,
      name,
      email,
      phone: '00000000000', // Placeholder phone
      role: 'customer',
      isVerified: true, // Social logins are automatically verified
      status: 'active',
    });
    await newUser.save();
    return newUser;
  }
}

module.exports = {
  findOrCreateGoogleUser,
  googleAuthClient: client,
};