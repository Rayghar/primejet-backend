// src/middleware/rateLimit.middleware.js
const rateLimit = require('express-rate-limit');
const { logger } = require('../config/logger.config');
const globalConfig = require('../config');

const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: globalConfig.env === 'production' ? 10 : 500, // FIX: Use ternary to set 10 for production
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests from this IP, please try again after 15 minutes.',
  },
  handler: (req, res, next, options) => {
    logger.warn(
      `Rate limit exceeded for IP ${req.ip} on route ${req.method} ${req.originalUrl}. ` +
      `Message: ${options.message.error || options.message}`
    );
    res.status(options.statusCode).json(options.message);
  },
});

module.exports = { rateLimiter };