// src/middleware/error.handler.js
const { Sentry, isSentryInitialized } = require('../config/sentry.config.js'); // Path to Sentry config
const { logger } = require('../config/logger.config.js'); // Path to Logger config
const globalConfig = require('../config'); // For NODE_ENV

/**
 * Centralized error handling middleware.
 */
const errorHandler = (error, req, res, next) => {
  const errorStatus = error.status || error.statusCode || 500;
  const errorMessage = error.message || 'An unexpected internal server error occurred.';

  // Detailed server-side logging
  logger.error(
    `${errorStatus} - ${errorMessage} - ${req.originalUrl} - ${req.method} - ${req.ip}`,
    {
      error: {
        message: error.message, // Already captured in main log message
        status: errorStatus,
        name: error.name,
        // Stack trace should only be logged in development for brevity in production logs,
        // Sentry will capture the full stack trace.
        stack: globalConfig.env === 'development' ? error.stack : undefined,
      },
      request: { // Basic request info for context
        method: req.method,
        url: req.originalUrl,
        ip: req.ip,
        // Avoid logging full req.headers or req.body in general logs unless redacted or in dev.
      },
    }
  );

  // Send to Sentry if initialized and not in a local/test environment that you want to exclude
  if (isSentryInitialized && globalConfig.env !== 'test' && globalConfig.env !== 'development') { // Example: only send to Sentry in prod/staging
    Sentry.withScope((scope) => {
      scope.setTag("path", req.path);
      scope.setTag("method", req.method);
      if (req.user && req.user.id) {
        scope.setUser({ id: req.user.id, role: req.user.role });
      }
      scope.setLevel(errorStatus >= 500 ? "error" : "warning"); // Categorize Sentry error level
      Sentry.captureException(error);
    });
  }

  const clientResponse = {
    error: errorMessage,
  };

  // Optionally, provide more error details in development
  if (globalConfig.env === 'development' && errorStatus >= 500 && error.stack) {
    clientResponse.stack = error.stack;
  }
  if (error.details && (globalConfig.env === 'development' || errorStatus < 500)) { // For Joi validation errors specifically
      clientResponse.details = error.details;
  }


  res.status(errorStatus).json(clientResponse);
};

module.exports = { errorHandler };