// src/middleware/auth.middleware.js
const jwt = require('jsonwebtoken');
const HttpError = require('../utils/HttpError'); 
const globalConfig = require('../config'); // Assuming src/config/index.js exports all configs
const { logger } = require('../config/logger.config'); 
const User = require('../models/user.model'); // ADDED: Import the User model

/**
 * Authentication middleware to verify JWT and optionally check roles.
 * Attaches the authenticated user object (from DB) to req.user.
 * @param {string} [requiredRole] - Optional role required to access the route.
 */
const authMiddleware = (requiredRole) => async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    console.log('[AUTH_MIDDLEWARE DEBUG] Request received:', req.method, req.path);
    console.log('[AUTH_MIDDLEWARE DEBUG] Auth Header:', authHeader); 

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('[AUTH_MIDDLEWARE DEBUG] No Bearer token found or malformed header.');
      return next(new HttpError(401, 'Authentication token is missing or malformed.'));
    }

    const token = authHeader.replace('Bearer ', '');
    if (!token) { 
        console.log('[AUTH_MIDDLEWARE DEBUG] Token extracted but empty.');
        return next(new HttpError(401, 'Authentication token not provided.'));
    }
    console.log('[AUTH_MIDDLEWARE DEBUG] Token received:', token);

    // Verify the JWT token using the secret from your config
    const jwtSecret = globalConfig.jwt.secret;
    console.log('[AUTH_MIDDLEWARE DEBUG] Using JWT Secret (first 5 chars):', jwtSecret ? jwtSecret.substring(0, 5) + '...' : 'NONE'); // Log part of secret for debug

    let decoded;
    try {
        decoded = jwt.verify(token, jwtSecret);
        console.log('[AUTH_MIDDLEWARE DEBUG] Token decoded:', decoded);
    } catch (jwtError) {
        console.error('[AUTH_MIDDLEWARE DEBUG] JWT Verification Failed:', jwtError.message, 'Name:', jwtError.name);
        if (jwtError.name === 'TokenExpiredError') {
            return next(new HttpError(401, 'Authentication token expired. Please log in again.'));
        }
        return next(new HttpError(401, 'Invalid authentication token.'));
    }
    
    // FETCH USER FROM DATABASE:
    console.log('[AUTH_MIDDLEWARE DEBUG] Attempting to find user with ID from token:', decoded.id);
    const user = await User.findOne({ id: decoded.id }); // Find user by their custom 'id' field

    if (!user) {
        console.log('[AUTH_MIDDLEWARE DEBUG] User from token ID NOT found in DB:', decoded.id);
        return next(new HttpError(401, 'User associated with token not found.'));
    }
    console.log('[AUTH_MIDDLEWARE DEBUG] User found in DB: ID:', user.id, 'Role:', user.role);

    // Role-based authorization check:
    if (allowedRoles.length > 0) {
        // FIX: Ensure user.role is trimmed before comparison.
        const userRoleTrimmed = user.role.trim(); // Trim the user's role
        const allowedRolesTrimmed = allowedRoles.map(role => role.trim()); // Ensure allowed roles are also trimmed

        logger.debug(`[AUTH_MIDDLEWARE DEBUG] Role check for user ${user.id}. Expected: ${allowedRolesTrimmed.join(',')}, Actual: ${userRoleTrimmed}`);

        if (!allowedRolesTrimmed.includes(userRoleTrimmed)) { // Compare trimmed roles
          logger.debug(`[AUTH_MIDDLEWARE DEBUG] Role mismatch for user ${user.id}. Expected: ${allowedRolesTrimmed.join(',')}, Actual: ${userRoleTrimmed}`);
          throw new HttpError(403, `Insufficient permissions for this resource. Your role is ${userRoleTrimmed}.`);
        }
      }

      req.user = user.toObject(); // Attach user object to request
      delete req.user.password; // Remove sensitive info
      logger.debug(`[AUTH_MIDDLEWARE DEBUG] req.user successfully set. Calling next().`);
      next();
    } catch (error) {
      logger.error(`[AUTH_MIDDLEWARE] Authentication/Authorization error: ${error.message}`, { stack: error.stack });
      if (error instanceof HttpError) {
        res.status(error.statusCode).json({ message: error.message });
      } else if (error.name === 'TokenExpiredError') {
        res.status(401).json({ message: 'Authentication failed: Token expired.' });
      } else if (error.name === 'JsonWebTokenError') {
        res.status(401).json({ message: 'Authentication failed: Invalid token.' });
      } else {
        res.status(500).json({ message: 'Authentication failed: An unexpected error occurred.' });
      }
    }
  }
  
module.exports = authMiddleware;
