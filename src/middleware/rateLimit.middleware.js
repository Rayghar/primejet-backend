// src/middleware/rateLimit.middleware.js
const rateLimit = require('express-rate-limit');
const { logger } = require('../config/logger.config'); // Import logger
const globalConfig = require('../config'); // ADD THIS LINE: Import your global config

const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: globalConfig.env === 'development' ? 500 : 10, // Allow many more requests in dev, e.g., 500
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: {
    error: 'Too many requests from this IP, please try again after 15 minutes.',
  },
  handler: (req, res, next, options) => {
    logger.warn(
      `Rate limit exceeded for IP ${req.ip} on route ${req.method} ${req.originalUrl}. ` +
      `Message: ${options.message.error || options.message}` // Log the actual message object or string
    );
    res.status(options.statusCode).json(options.message); // Send the configured message
  },
  // skip: (req, res) => process.env.NODE_ENV === 'development', // Optional: skip during development
});

module.exports = { rateLimiter };
