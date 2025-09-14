// src/server.js
require('dotenv').config(); // Ensure environment variables are loaded at the very beginning

process.on('unhandledRejection', (reason, promise) => {
  console.error('<<<<< UNHANDLED REJECTION >>>>> Reason:', reason);
  console.error('<<<<< UNHANDLED REJECTION >>>>> At Promise:', promise);
  // logger.fatal('Unhandled Rejection:', { reason, promiseString: String(promise) }); // Use logger if initialized
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('<<<<< UNCAUGHT EXCEPTION >>>>> Error:', error);
  // logger.fatal('Uncaught Exception:', error); // Use logger if initialized
  process.exit(1);
});

// ✅ CORRECTED: Import the unified server instance from app.js
const server = require('./app');
const globalConfig = require('./config'); // Import the global config
const { logger } = require('./config/logger.config.js');
// Import connectMongoDB, and also connectRedis and redisClient from database.config.js
const { connectMongoDB, connectRedis, redisClient } = require('./config/database.config.js');

const PORT = globalConfig.port;

async function startServer() {
  logger.info('[SERVER] startServer called.');
  try {
    if (globalConfig.env !== 'test') {
      logger.info('[SERVER] Connecting to MongoDB...');
      await connectMongoDB();
      logger.info('[SERVER] MongoDB connection attempt finished.');

      // Conditionally connect to Redis ONLY if REDIS_URL was set (which means redisClient will exist)
      if (redisClient && typeof connectRedis === 'function') {
          logger.info('[SERVER] Attempting to connect to Redis...');
          await connectRedis(); // This function already checks if client is not open
          // The connectRedis function itself logs success or failure.
          logger.info('[SERVER] Redis connection attempt sequence finished.');
      } else {
          logger.warn('[SERVER] Redis not configured (REDIS_URL not set in .env or client not available). Skipping Redis connection.');
      }
    } else {
        logger.info('[SERVER] Skipping DB and Redis connections in test environment.');
    }

    // ✅ CORRECTED: Use the unified server instance to listen
    server.listen(PORT, '0.0.0.0', () => {
      logger.info(`[SERVER] Server running on port ${PORT}`);
      logger.info(`[SERVER] Environment: ${globalConfig.env}`);
    });
    logger.info('[SERVER] server.listen called, process should be kept alive.');
  } catch (error) {
    logger.error('[SERVER] Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown (remains the same)
const gracefulShutdown = (signal) => {
  logger.info(`[SERVER] ${signal} received. Shutting down gracefully...`);
  server.close(() => {
    logger.info('[SERVER] HTTP server closed.');
    if (mongoose.connection.readyState === 1) { // Check if mongoose is connected
        mongoose.disconnect().then(() => {
            logger.info('MongoDB connection closed through app termination');
        }).catch(err => {
            logger.error('Error disconnecting MongoDB:', err);
        }).finally(() => {
            if (redisClient && redisClient.isOpen) {
                redisClient.quit().then(() => {
                    logger.info('Redis client connection closed through app termination.');
                }).catch(err => {
                    logger.error('Error closing Redis client:', err);
                }).finally(() => process.exit(0));
            } else {
                process.exit(0);
            }
        });
    } else if (redisClient && redisClient.isOpen) {
        redisClient.quit().then(() => {
            logger.info('Redis client connection closed through app termination.');
        }).catch(err => {
            logger.error('Error closing Redis client:', err);
        }).finally(() => process.exit(0));
    } else {
        process.exit(0);
    }
  });

  // Force close server after a timeout
  setTimeout(() => {
    logger.error('[SERVER] Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000); // 10 seconds
};

// Mongoose import for graceful shutdown of MongoDB
const mongoose = require('mongoose'); 

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

if (require.main === module) {
  startServer();
}