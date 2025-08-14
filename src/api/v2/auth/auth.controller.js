// src/api/v2/auth/auth.controller.js
const jwt = require('jsonwebtoken');
const userService = require('../../v1/users/user.service'); // Reuse existing v1 user service for core logic
const HttpError = require('../../../utils/HttpError');
const { jwt: jwtConfig } = require('../../../config'); // Import JWT configuration

/**
 * @desc Authenticate user (login) for web clients.
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 * @param {function} next - Express next middleware function.
 */
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Use the existing userService to find and validate user credentials
    const user = await userService.findUserByCredentials(email, password);

    if (!user) {
      throw new HttpError(401, 'Invalid email or password.');
    }

    // Generate a JWT token with user ID and role
    const token = jwt.sign(
      { id: user.id, role: user.role, email: user.email }, // Include user ID, role, and email in token payload
      jwtConfig.secret,
      { expiresIn: jwtConfig.expiresIn } // Token expiration from config
    );

    // Return the token and essential user details
    res.status(200).json({ 
      token, 
      user: { 
        id: user.id, 
        name: user.name,
        email: user.email,
        role: user.role,
      }
    });
  } catch (error) {
    // Pass errors to the error handling middleware
    next(error);
  }
};

module.exports = { login };