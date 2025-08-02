// File: src/middleware/auth.middleware.js (Updated)
const jwt = require('jsonwebtoken');
const HttpError = require('../utils/HttpError');
const { logger } = require('../config/logger.config');
const User = require('../models/user.model');

// ================== MODIFICATION START: Import the Agent model ==================
const Agent = require('../models/agent.model');
// =================== MODIFICATION END: Import the Agent model ===================

const JWT_SECRET = process.env.JWT_SECRET || 'your-default-super-secret-key-for-dev';

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

    if (!JWT_SECRET) {
        logger.error('[AUTH_MIDDLEWARE] JWT secret is not configured on the server.');
        return next(new HttpError(500, 'Server configuration error.'));
    }
    logger.debug('[AUTH_MIDDLEWARE] Using JWT Secret for verification.');

    let decoded;
    try {
        decoded = jwt.verify(token, JWT_SECRET);
        logger.debug('[AUTH_MIDDLEWARE] Token decoded:', { decoded });
    } catch (jwtError) {
        logger.error('[AUTH_MIDDLEWARE] JWT Verification Failed:', { message: jwtError.message, name: jwtError.name });
        if (jwtError.name === 'TokenExpiredError') {
            return next(new HttpError(401, 'Authentication token expired. Please log in again.'));
        }
        return next(new HttpError(401, 'Invalid authentication token.'));
    }

    // ================== MODIFICATION START: Role-based Entity Lookup ==================
    let entity; // Use a generic variable for the user or agent
    const entityId = decoded.id;
    const entityRole = decoded.role;

    // Check the role from the token and query the correct database collection
    if (entityRole === 'agent') {
        logger.debug(`[AUTH_MIDDLEWARE] Role is 'agent', searching in Agents collection for ID: ${entityId}`);
        entity = await Agent.findOne({ id: entityId });
    } else {
        logger.debug(`[AUTH_MIDDLEWARE] Role is '${entityRole || 'unknown'}', searching in Users collection for ID: ${entityId}`);
        entity = await User.findOne({ id: entityId });
    }

    if (!entity) {
        logger.warn(`[AUTH_MIDDLEWARE] Entity with role '${entityRole}' and ID '${entityId}' NOT found in DB.`);
        return next(new HttpError(401, 'User or Agent associated with token not found.'));
    }
    logger.debug(`[AUTH_MIDDLEWARE] Entity found in DB:`, { entityId: entity.id, role: entity.role });

    if (requiredRole && entity.role !== requiredRole) {
      logger.warn(`[AUTH_MIDDLEWARE] Role mismatch for entity ${entity.id}. Expected: ${requiredRole}, Actual: ${entity.role}`);
      return next(new HttpError(403, `Insufficient permissions. Your role is '${entity.role}'.`));
    }

    // Attach the found entity (user or agent) to the request object for use in controllers
    req.user = entity;
    // =================== MODIFICATION END: Role-based Entity Lookup ===================
    
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