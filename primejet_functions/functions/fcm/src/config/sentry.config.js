// src/config/sentry.config.js
const Sentry = require('@sentry/node');
// If you use @sentry/profiling-node
// const { ProfilingIntegration } = require("@sentry/profiling-node");
const globalConfig = require('./index');
const { logger } = require('./logger.config'); // For logging Sentry initialization

let isSentryInitialized = false;

if (globalConfig.sentry.dsn && globalConfig.env !== 'test') { // Don't init Sentry for tests
  try {
    Sentry.init({
      dsn: globalConfig.sentry.dsn,
      environment: globalConfig.env,
      tracesSampleRate: globalConfig.env === 'production' ? 0.5 : 1.0, // Adjust sample rates
      // profilesSampleRate: 1.0, // If using profiling
      // integrations: [
      //   new ProfilingIntegration(), // If using profiling
      // ],
      // Add release, etc. from environment variables if available
      // release: process.env.APP_VERSION,
    });
    logger.info('[SENTRY_CONFIG] Sentry initialized successfully.');
    isSentryInitialized = true;
  } catch (error) {
    logger.error('[SENTRY_CONFIG] Failed to initialize Sentry:', error);
  }
} else if (globalConfig.env !== 'test') {
  logger.warn('[SENTRY_CONFIG] Sentry DSN not found. Sentry will not be initialized.');
} else {
  logger.info('[SENTRY_CONFIG] Sentry not initialized in test environment.');
}

module.exports = {
  Sentry, // Export the Sentry instance itself for use in error handlers etc.
  isSentryInitialized,
};