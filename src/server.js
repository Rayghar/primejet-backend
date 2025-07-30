// File: src/server.js

process.on('unhandledRejection', (reason, promise) => {
  console.error('<<<<< UNHANDLED REJECTION >>>>> Reason:', reason);
  console.error('<<<<< UNHANDLED REJECTION >>>>> At Promise:', promise);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('<<<<< UNCAUGHT EXCEPTION >>>>> Error:', error);
  process.exit(1);
});

const http = require('http');
let initializeApp; 
const { logger } = require('./config/logger.config.js');
const { connectMongoDB, connectRedis, redisClient } = require('./config/database.config.js');

const mongoose = require('mongoose'); 

let globalConfig; 
let server; 

async function startServer() {
  logger.info('[SERVER] startServer called.');
  try {
    logger.info('[SERVER] Loading application configuration...');
    globalConfig = require('./config').config;
    logger.info('[SERVER] Application configuration loaded successfully.');

    initializeApp = require('./app'); 
    const app = initializeApp(globalConfig, logger); 

    const PORT = globalConfig.port; 
    server = http.createServer(app); 

    if (globalConfig.env !== 'test') {
      logger.info('[SERVER] Connecting to MongoDB...');
      await connectMongoDB(globalConfig.mongo.uri); 
      logger.info('[SERVER] MongoDB connection attempt finished.');

      if (globalConfig.redis && globalConfig.redis.url && typeof connectRedis === 'function') {
          logger.info('[SERVER] Attempting to connect to Redis...');
          await connectRedis(globalConfig.redis.url); 
          logger.info('[SERVER] Redis connection attempt sequence finished.');
      } else {
          logger.warn('[SERVER] Redis not configured (REDIS_URL not set in secrets/env or client not available). Skipping Redis connection.');
      }
    } else {
        logger.info('[SERVER] Skipping DB and Redis connections in test environment.');
    }

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

const gracefulShutdown = (signal) => {
  logger.info(`[SERVER] ${signal} received. Shutting down gracefully...`);
  if (server) {
    server.close(() => {
      logger.info('[SERVER] HTTP server closed.');
      if (mongoose.connection && mongoose.connection.readyState === 1) { 
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
  } else {
    logger.warn('[SERVER] HTTP server not initialized, exiting directly.');
    process.exit(0); 
  }

  setTimeout(() => {
    logger.error('[SERVER] Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000); 
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

if (require.main === module) {
  startServer();
}

module.exports = startServer;