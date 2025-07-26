// File: src/middleware/error.handler.js

const { logger } = require('../config/logger.config.js'); 

/**
 * Centralized error handling middleware.
 * @param {object} config - The loaded application configuration.
 */
const errorHandler = (config) => { 
  // Sentry initialization logic
  if (config.sentry && config.sentry.dsn && config.env !== 'test' && config.env !== 'development') {
    const Sentry = require('@sentry/node');
    if (!Sentry.isInitialized()) {
      try {
        Sentry.init({
          dsn: config.sentry.dsn,
          environment: config.env,
          tracesSampleRate: config.env === 'production' ? 0.5 : 1.0, 
        });
        logger.info('[SENTRY_CONFIG] Sentry initialized successfully in error handler.');
      } catch (error) {
        logger.error('[SENTRY_CONFIG] Failed to initialize Sentry in error handler:', error);
      }
    } else {
        logger.info('[SENTRY_CONFIG] Sentry already initialized.');
    }
  } else if (config.env !== 'test') {
    logger.warn('[SENTRY_CONFIG] Sentry DSN not found or not in production/test env. Sentry will not be initialized.');
  } else {
    logger.info('[SENTRY_CONFIG] Sentry not initialized in test environment.');
  }

  return (err, req, res, next) => {
    const errorStatus = err.status || err.statusCode || 500;
    const errorMessage = err.message || 'An unexpected internal server error occurred.';

    logger.error(
      `${errorStatus} - ${errorMessage} - ${req.originalUrl} - ${req.method} - ${req.ip}`,
      {
        error: {
          message: err.message,
          status: errorStatus,
          name: err.name,
          stack: config.env === 'development' ? err.stack : undefined, 
        },
        request: {
          method: req.method,
          url: req.originalUrl,
          ip: req.ip,
        },
      }
    );

    if (config.sentry && config.sentry.dsn && config.env !== 'test' && config.env !== 'development') {
        const Sentry = require('@sentry/node'); 
        if (Sentry.isInitialized()) { 
            Sentry.withScope((scope) => {
                scope.setTag("path", req.path);
                scope.setTag("method", req.method);
                if (req.user && req.user.id) {
                    scope.setUser({ id: req.user.id, role: req.user.role });
                }
                scope.setLevel(errorStatus >= 500 ? "error" : "warning");
                Sentry.captureException(err);
            });
        }
    }

    const clientResponse = {
      error: errorMessage,
    };

    if (config.env === 'development' && errorStatus >= 500 && err.stack) { 
      clientResponse.stack = err.stack;
    }
    if (err.details && (config.env === 'development' || errorStatus < 500)) { 
        clientResponse.details = err.details;
    }

    res.status(errorStatus).json(clientResponse);
  };
};

module.exports = { errorHandler };