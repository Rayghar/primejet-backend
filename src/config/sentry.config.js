// src/config/sentry.config.js

// We still require Sentry here to export it, but the initialization logic
// will be handled where the 'config' object is available (e.g., in error.handler.js).
const Sentry = require('@sentry/node'); 

// No need to import globalConfig directly here anymore.
// No need for 'isSentryInitialized' flag here, the Sentry SDK itself has isInitialized().

// Export the Sentry instance directly.
module.exports = {
  Sentry, // Export the Sentry instance itself for use in error handlers etc.
};