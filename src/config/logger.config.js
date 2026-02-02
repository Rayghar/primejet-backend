// File: src/config/logger.config.js
const winston = require('winston');
const globalConfig = require('./index');

const { combine, timestamp, json, printf, colorize, errors } = winston.format;

// Show stack if available
const consoleFormat = printf(({ level, message, timestamp, stack }) => {
  return `${timestamp} ${level}: ${stack || message}`;
});

// Resolve log level in a predictable way
// Priority: LOG_LEVEL env > globalConfig.logLevel > default per NODE_ENV
const resolvedLevel =
  process.env.LOG_LEVEL ||
  globalConfig.logLevel ||
  (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

const logger = winston.createLogger({
  level: resolvedLevel,

  // Default format for non-console transports (files)
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }), // ensures `stack` is captured for error objects
    json()
  ),

  transports: [
    // ✅ File logs (optional; kept for local/VM debugging)
    new winston.transports.File({ filename: 'logs/app-error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/app-combined.log' }),

    // ✅ Console logs (REQUIRED for Render visibility)
    new winston.transports.Console({
      level: resolvedLevel,
      format: combine(
        colorize(),
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        errors({ stack: true }),
        consoleFormat
      ),
    }),
  ],

  // Keep these, but note: they only apply to uncaught/unhandled, not normal logs
  exceptionHandlers: [
    new winston.transports.File({ filename: 'logs/exceptions.log' }),
    new winston.transports.Console({
      level: 'error',
      format: combine(
        colorize(),
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        errors({ stack: true }),
        consoleFormat
      ),
    }),
  ],

  rejectionHandlers: [
    new winston.transports.File({ filename: 'logs/rejections.log' }),
    new winston.transports.Console({
      level: 'error',
      format: combine(
        colorize(),
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        errors({ stack: true }),
        consoleFormat
      ),
    }),
  ],

  // Usually safer in production to NOT exit on handled errors
  exitOnError: false,
});

// Stream for morgan
logger.stream = {
  write: (message) => {
    logger.info(message.trim());
  },
};

module.exports = { logger };
