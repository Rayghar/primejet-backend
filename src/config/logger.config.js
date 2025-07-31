// File: src/config/logger.config.js
const winston = require('winston');
const globalConfig = require('./index'); // For log level

const { combine, timestamp, json, printf, colorize } = winston.format;

// This format will now correctly show stack if available
const consoleFormat = printf(({ level, message, timestamp, stack }) => {
  return `${timestamp} ${level}: ${stack || message}`;
});

const logger = winston.createLogger({
  level: 'debug', // THIS IS KEY: Set to 'debug' to capture debug logs globalConfig.logLevel || 'info', // Overall logger level
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(info => `${info.timestamp} ${info.level.toUpperCase()}: ${info.message}`)
  ),
  transports: [
    new winston.transports.Console(),
    //new winston.transports.File({ filename: 'logs/app-error.log', level: 'error' }),
   // new winston.transports.File({ filename: 'logs/app-combined.log' }),
  ],
  exceptionHandlers: [ // For uncaught exceptions
    new winston.transports.File({ filename: 'logs/exceptions.log' }),
    new winston.transports.Console({ // Also log to console during dev
      format: combine(colorize(), timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), consoleFormat),
      level: globalConfig.logLevel || 'info' // Inherit or explicitly set for this handler
    })
  ],
  rejectionHandlers: [ // For unhandled promise rejections
    new winston.transports.File({ filename: 'logs/rejections.log' })
  ],
  exitOnError: true, // Can keep true if handlers are defined
});

// If not in production, add/configure console transport with colorized simple format
// This block ensures the console transport actually logs at the desired level.
if (globalConfig.env !== 'production') {
  // Remove existing console transport from `exceptionHandlers` if it exists, to avoid duplicates
  // This might be tricky; easier to ensure `add` sets correct level.
  logger.add(new winston.transports.Console({
    format: combine(
      colorize(), // Add colors for console output
      timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), // Timestamp for console
      consoleFormat // Custom format for console
    ),
    level: globalConfig.logLevel || 'debug', // <<< MODIFIED: Explicitly set console transport level to 'debug'
  }));
} else {
  // Production logging (e.g., to a file, structured JSON for log management systems)
  // Ensure file transports are defined correctly for production here
  logger.add(new winston.transports.File({ filename: 'logs/app-combined.log' }));
  logger.add(new winston.transports.File({ filename: 'logs/app-error.log', level: 'error' }));
}


// Create a stream object with a 'write' function that will be used by `morgan`
logger.stream = {
  write: (message) => {
    // Morgan messages typically have a newline character, remove it
    logger.info(message.trim());
  },
};

module.exports = { logger };