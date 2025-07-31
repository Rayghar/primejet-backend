// File: src/config/logger.config.js
const winston = require('winston');

// Define a basic logger for initial configuration loading (avoids circular dependency)
const basicLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} ${level}: ${message}`)
  ),
  transports: [new winston.transports.Console()],
});

// This format will now correctly show stack if available
const consoleFormat = winston.format.printf(({ level, message, timestamp, stack }) => {
  return `${timestamp} ${level}: ${stack || message}`;
});

let logger;

async function initializeLogger() {
  // Use a default log level until config is available
  const defaultLogLevel = 'info';

  logger = winston.createLogger({
    level: defaultLogLevel, // Default level, will be updated if config is loaded
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.printf(info => `${info.timestamp} ${info.level.toUpperCase()}: ${info.message}`)
    ),
    transports: [
      new winston.transports.Console(),
    ],
    exceptionHandlers: [
      new winston.transports.File({ filename: 'logs/exceptions.log' }),
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
          consoleFormat
        ),
        level: defaultLogLevel,
      }),
    ],
    rejectionHandlers: [
      new winston.transports.File({ filename: 'logs/rejections.log' })
    ],
    exitOnError: true,
  });

  // Attempt to load config to update log level (non-blocking)
  try {
    const { loadConfig } = require('./index');
    const config = await loadConfig();
    if (config && config.logLevel) {
      logger.level = config.logLevel;
      logger.info(`[LOGGER] Log level updated to ${config.logLevel} from configuration.`);
    }
  } catch (error) {
    basicLogger.error('[LOGGER] Failed to load configuration for log level:', error);
  }

  // Configure additional transports based on environment
  if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        consoleFormat
      ),
      level: logger.level,
    }));
  } else {
    logger.add(new winston.transports.File({ filename: 'logs/app-combined.log' }));
    logger.add(new winston.transports.File({ filename: 'logs/app-error.log', level: 'error' }));
  }

  // Create a stream object for morgan
  logger.stream = {
    write: (message) => {
      logger.info(message.trim());
    },
  };

  return logger;
}

// Initialize logger and export
module.exports = { logger: initializeLogger() };