// src/middleware/auth.middleware.js
// ADVISORY: This version has been corrected to properly load the global configuration.

const jwt = require('jsonwebtoken');
const HttpError = require('../utils/HttpError'); 
// MODIFIED: We now import the resolved config object directly.
const globalConfig = require('../config').config; 
const { logger } = require('../config/logger.config'); 
const User = require('../models/user.model');

const authMiddleware = (requiredRole) => async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next(new HttpError(401, 'Authentication token is missing or malformed.'));
    }

    const token = authHeader.replace('Bearer ', '');
    if (!token) { 
        return next(new HttpError(401, 'Authentication token not provided.'));
    }

    // This line will now work correctly as globalConfig is the resolved object.
    const jwtSecret = globalConfig.jwt.secret;

    let decoded;
    try {
        decoded = jwt.verify(token, jwtSecret);
    } catch (jwtError) {
        if (jwtError.name === 'TokenExpiredError') {
            return next(new HttpError(401, 'Authentication token expired. Please log in again.'));
        }
        return next(new HttpError(401, 'Invalid authentication token.'));
    }
    
    const user = await User.findOne({ id: decoded.id });

    if (!user) {
        return next(new HttpError(401, 'User associated with token not found.'));
    }

    if (requiredRole && user.role !== requiredRole) {
      return next(new HttpError(403, `Insufficient permissions for this resource. Your role is ${user.role}.`));
    }

    req.user = user; 
    next();
  } catch (error) {
    logger.error('[AUTH_MIDDLEWARE] UNEXPECTED Authentication error:', error);
    return next(new HttpError(500, 'Authentication process failed due to an unexpected server error.'));
  }
};

module.exports = authMiddleware;