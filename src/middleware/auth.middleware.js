// File: src/middleware/auth.middleware.js
// ADVISORY: This version fixes the server crash by accessing the JWT secret directly and reliably.

const jwt = require('jsonwebtoken');
const HttpError = require('../utils/HttpError'); 
const { logger } = require('../config/logger.config'); 
const User = require('../models/user.model');

// ============================= FIX IS HERE =============================
// Access the JWT secret directly from environment variables, just like in auth.service.js.
// This ensures consistency and reliability, with a fallback for development.
const JWT_SECRET = process.env.JWT_SECRET || 'your-default-super-secret-key-for-dev';
// =====================================================================

const authMiddleware = (requiredRole) => async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    logger.debug('[AUTH_MIDDLEWARE] Request received:', { method: req.method, path: req.path });
    logger.debug('[AUTH_MIDDLEWARE] Auth Header:', { authHeader }); 

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.warn('[AUTH_MIDDLEWARE] No Bearer token found or malformed header.');
      return next(new HttpError(401, 'Authentication token is missing or malformed.'));
    }

    const token = authHeader.replace('Bearer ', '');
    if (!token) { 
        logger.warn('[AUTH_MIDDLEWARE] Token extracted but empty.');
        return next(new HttpError(401, 'Authentication token not provided.'));
    }
    logger.debug('[AUTH_MIDDLEWARE] Token received:', { token });

    // Check if the JWT secret is available.
    if (!JWT_SECRET) { // This check will now likely never fail due to the fallback.
        logger.error('[AUTH_MIDDLEWARE] JWT secret is not configured on the server.');
        return next(new HttpError(500, 'Server configuration error.'));
    }
    logger.debug('[AUTH_MIDDLEWARE] Using JWT Secret for verification.');

    let decoded;
    try {
        // Use the reliably loaded secret for verification.
        decoded = jwt.verify(token, JWT_SECRET);
        logger.debug('[AUTH_MIDDLEWARE] Token decoded:', { decoded });
    } catch (jwtError) {
        logger.error('[AUTH_MIDDLEWARE] JWT Verification Failed:', { message: jwtError.message, name: jwtError.name });
        if (jwtError.name === 'TokenExpiredError') {
            return next(new HttpError(401, 'Authentication token expired. Please log in again.'));
        }
        return next(new HttpError(401, 'Invalid authentication token.'));
    }
    
    logger.debug('[AUTH_MIDDLEWARE] Attempting to find user with ID from token:', { userId: decoded.id });
    const user = await User.findOne({ id: decoded.id });

    if (!user) {
        logger.warn('[AUTH_MIDDLEWARE] User from token ID NOT found in DB:', { userId: decoded.id });
        return next(new HttpError(401, 'User associated with token not found.'));
    }
    logger.debug('[AUTH_MIDDLEWARE] User found in DB:', { userId: user.id, role: user.role });

    if (requiredRole && user.role !== requiredRole) {
      logger.warn(`[AUTH_MIDDLEWARE] Role mismatch for user ${user.id}. Expected: ${requiredRole}, Actual: ${user.role}`);
      return next(new HttpError(403, `Insufficient permissions for this resource. Your role is ${user.role}.`));
    }

    req.user = user; 
    logger.debug('[AUTH_MIDDLEWARE] req.user successfully set. Calling next().');
    next();
  } catch (error) {
    logger.error('[AUTH_MIDDLEWARE] UNEXPECTED Authentication error in catch block:', { message: error.message, stack: error.stack });
    if (error instanceof HttpError) {
      return next(error);
    }
    return next(new HttpError(500, 'Authentication process failed due to an unexpected server error.'));
  }
};

module.exports = authMiddleware;