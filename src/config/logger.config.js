// File: src/config/logger.config.js
const { createLogger, format, transports } = require('winston');
const path = require('path');

const { combine, timestamp, printf, colorize, errors } = format;

// Custom log format for console
const consoleLogFormat = printf(({ level, message, timestamp, stack, context, ...metadata }) => {
  let logMessage = `${timestamp} [${level}]`;
  if (context) {
    logMessage += ` [${context}]`; // Add context if provided
  }
  logMessage += `: ${message}`;

  if (stack) {
    logMessage += `\n${stack}`; // Add stack trace if available
  }

  // Add any other metadata, but filter out common Express/logger properties that are already handled
  const filteredMetadata = { ...metadata };
  delete filteredMetadata.level;
  delete filteredMetadata.message;
  delete filteredMetadata.timestamp;
  delete filteredMetadata.stack;
  delete filteredMetadata.context; // Already handled

  if (Object.keys(filteredMetadata).length > 0) {
    logMessage += `\nMetadata: ${JSON.stringify(filteredMetadata, null, 2)}`; // Pretty print metadata
  }
  return logMessage;
});

// Custom log format for files (without colors for cleaner file output)
const fileLogFormat = printf(({ level, message, timestamp, stack, context, ...metadata }) => {
  let logMessage = `${timestamp} [${level}]`;
  if (context) {
    logMessage += ` [${context}]`;
  }
  logMessage += `: ${message}`;

  if (stack) {
    logMessage += `\n${stack}`;
  }

  const filteredMetadata = { ...metadata };
  delete filteredMetadata.level;
  delete filteredMetadata.message;
  delete filteredMetadata.timestamp;
  delete filteredMetadata.stack;
  delete filteredMetadata.context;

  if (Object.keys(filteredMetadata).length > 0) {
    logMessage += `\nMetadata: ${JSON.stringify(filteredMetadata)}`; // JSON stringify for file
  }
  return logMessage;
});


const logger = createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug', // Log 'debug' and above in dev, 'info' and above in prod
  format: errors({ stack: true }), // Capture stack traces
  transports: [
    // Console Transport: Outputs logs to the console
    new transports.Console({
      format: combine(
        colorize({ all: true }), // Add colors for console output
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        consoleLogFormat
      ),
      handleExceptions: true, // Catch and log uncaught exceptions
    }),

    // File Transport for all logs (optional, but good for production)
    new transports.File({
      filename: path.join(__dirname, '../../logs/combined.log'), // All logs
      level: 'info', // Only info and above go to this file
      format: combine(
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        fileLogFormat
      ),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
      tailable: true, // Start logging from the end of the file
      handleExceptions: true,
    }),

    // File Transport for errors only (optional, but highly recommended)
    new transports.File({
      filename: path.join(__dirname, '../../logs/error.log'), // Only errors
      level: 'error', // Only errors and above go to this file
      format: combine(
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        fileLogFormat
      ),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
      handleExceptions: true,
    }),
  ],
  // Exit on unhandled exceptions (true by default with handleExceptions)
  exitOnError: false,
});

// Create a stream object to allow morgan to use winston for HTTP logging
logger.stream = {
  write: function(message, encoding) {
    logger.info(message.trim(), { context: 'HTTP' }); // Log HTTP requests with 'HTTP' context
  },
};

module.exports = { logger };