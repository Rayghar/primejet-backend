// src/middleware/auth.middleware.js
const jwt = require('jsonwebtoken');
const HttpError = require('../utils/HttpError'); 
const globalConfig = require('../config'); // Assuming src/config/index.js exports all configs
const { logger } = require('../config/logger.config'); // Use the configured logger
const User = require('../models/user.model'); // Import the User model

/**
 * Authentication middleware to verify JWT and optionally check roles.
 * Attaches the authenticated user object (from DB) to req.user.
 * @param {string|Array<string>} [requiredRole] - Optional role(s) required to access the route.
 * Can be a single string or an array of strings.
 */
const authMiddleware = (requiredRole) => async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.warn(`[AUTH_MIDDLEWARE] Missing or malformed Authorization header for ${req.method} ${req.path}`);
      return next(new HttpError(401, 'Authentication token is missing or malformed.'));
    }

    const token = authHeader.replace('Bearer ', '');
    if (!token) { 
      logger.warn(`[AUTH_MIDDLEWARE] Token extracted but empty for ${req.method} ${req.path}`);
      return next(new HttpError(401, 'Authentication token not provided.'));
    }

    const jwtSecret = globalConfig.jwt.secret;
    if (!jwtSecret || jwtSecret === 'fallback_super_secret_key_for_dev_only_please_change') {
      logger.error('[AUTH_MIDDLEWARE] JWT_SECRET is not configured securely for production.');
      return next(new HttpError(500, 'Server configuration error: JWT secret not set.'));
    }

    let decoded;
    try {
      decoded = jwt.verify(token, jwtSecret);
    } catch (jwtError) {
      logger.error(`[AUTH_MIDDLEWARE] JWT Verification Failed for ${req.method} ${req.path}: ${jwtError.message}`, { jwtErrorName: jwtError.name });
      if (jwtError.name === 'TokenExpiredError') {
        return next(new HttpError(401, 'Authentication token expired. Please log in again.'));
      }
      return next(new HttpError(401, 'Invalid authentication token.'));
    }
    
    // FETCH USER FROM DATABASE:
    // It's crucial to fetch the user from the DB to ensure they still exist and their role/status is current.
    const user = await User.findOne({ id: decoded.id }).select('+password'); // Select +password temporarily if needed for comparePassword later, otherwise remove.
                                                                           // Or, better, refactor findUserByCredentials to not rely on selected password.
    if (!user) {
      logger.warn(`[AUTH_MIDDLEWARE] User with ID ${decoded.id} from token not found in DB for ${req.method} ${req.path}`);
      return next(new HttpError(401, 'User associated with token not found or no longer exists.'));
    }

    // Role-based authorization check:
    if (requiredRole) {
      const rolesArray = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
      if (!rolesArray.includes(user.role)) {
        logger.warn(`[AUTH_MIDDLEWARE] Forbidden access for user ${user.id} (role: ${user.role}) to ${req.method} ${req.path}. Required roles: ${rolesArray.join(', ')}`);
        return next(new HttpError(403, `Insufficient permissions. Your role (${user.role}) is not authorized for this action.`));
      }
    }

    // Attach the fetched Mongoose user document to `req.user`.
    // Exclude sensitive fields like password before attaching to request.
    const userObject = user.toObject();
    delete userObject.password; 
    req.user = userObject; 
    
    logger.debug(`[AUTH_MIDDLEWARE] User ${req.user.id} (role: ${req.user.role}) authenticated for ${req.method} ${req.path}`);
    next(); // Proceed to the next middleware or route handler
  } catch (error) {
    // Catch any unexpected errors during the middleware execution
    logger.error(`[AUTH_MIDDLEWARE] Unexpected error in authentication process for ${req.method} ${req.path}: ${error.message}`, { stack: error.stack });
    if (error instanceof HttpError) {
      return next(error); // Pass custom HttpErrors directly
    }
    // Fallback for other unexpected errors
    return next(new HttpError(500, 'Authentication process failed due to an unexpected server error.'));
  }
};

module.exports = authMiddleware;