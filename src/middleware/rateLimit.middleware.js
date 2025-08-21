// File: src/middleware/rateLimit.middleware.js
const rateLimit = require('express-rate-limit');
const { logger } = require('../config/logger.config');

// IMPORTANT: For this middleware to work correctly behind a proxy like Render,
// you MUST enable 'trust proxy' in your app.js file: app.set('trust proxy', 1);

const generalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Standard limit for production
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests from this IP, please try again after 15 minutes.',
  },
  handler: (req, res, next, options) => {
    logger.warn(
      `Rate limit exceeded for IP ${req.ip} on route ${req.method} ${req.originalUrl}. ` +
      `Limit: ${options.max}, Remaining: ${res.get('RateLimit-Remaining') || 0}, Reset: ${res.get('RateLimit-Reset') || 0}`
    );
    res.status(options.statusCode).json(options.message);
  },
});

const webhookRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // Higher limit for webhook endpoints in production
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many webhook requests, please try again later.',
  },
  handler: (req, res, next, options) => {
    logger.warn(
      `Webhook rate limit exceeded for IP ${req.ip} on route ${req.method} ${req.originalUrl}. ` +
      `Limit: ${options.max}, Remaining: ${res.get('RateLimit-Remaining') || 0}, Reset: ${res.get('RateLimit-Reset') || 0}`
    );
    res.status(options.statusCode).json(options.message);
  },
});

module.exports = { generalRateLimiter, webhookRateLimiter };