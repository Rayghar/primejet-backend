// src/config/database.config.js
const mongoose = require('mongoose');
const Redis = require('redis');
const globalConfig = require('./index'); // Load from the main config index
const { logger } = require('./logger.config'); // Load logger for DB events
const { redactConnectionString } = require('../utils/productionSafety');

mongoose.set('strictQuery', true);

const connectMongoDB = async () => {
  try {
    logger.info(`[DB_CONFIG] Attempting to connect to MongoDB with URI: ${redactConnectionString(globalConfig.mongo.uri)}`);
    await mongoose.connect(globalConfig.mongo.uri, {
      // useNewUrlParser: true, // Deprecated in Mongoose 6+
      // useUnifiedTopology: true, // Deprecated in Mongoose 6+
      // Mongoose 6+ uses these by default
    });
    logger.info('MongoDB connected successfully.');

    mongoose.connection.on('error', (err) => {
      logger.error(`MongoDB connection error after initial connection: ${err.message}`);
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected.');
    });

  } catch (error) {
    logger.error(`Initial MongoDB connection error: ${error.message}`);
    // Consider exiting process if DB connection is critical for startup
    // process.exit(1);
    throw error; // Re-throw to be caught by server.js startup
  }
};

let redisClientInstance;

const getRedisClient = () => {
  if (redisClientInstance && redisClientInstance.isOpen) {
    return redisClientInstance;
  }
  if (globalConfig.redis.url) {
     redisClientInstance = Redis.createClient({
       url: globalConfig.redis.url,
     });

     redisClientInstance.on('error', (err) => logger.error(`Redis Client Error: ${err}`));
     redisClientInstance.on('connect', () => logger.info('Redis connected successfully.'));
     redisClientInstance.on('reconnecting', () => logger.warn('Redis reconnecting...'));
     redisClientInstance.on('end', () => logger.info('Redis connection ended.'));

     // Connect the client. This needs to be awaited where it's first needed,
     // or connected explicitly during app startup.
     // For simplicity with existing services, they might try to connect on first use if not already.
     // Better to connect explicitly during app startup.
     // We will not call .connect() here, services that use it should ensure it's connected.
     // Or, add a connectRedis function similar to connectMongoDB.
     return redisClientInstance;
  }
  logger.warn('Redis URL not configured. Redis client not created.');
  return null; // Return null if not configured
};

// Optional: function to explicitly connect Redis during startup
const connectRedis = async () => {
    const client = getRedisClient(); // Will be null if no URL
    if (client && !client.isOpen) { // Check if client exists and is not open
        try {
            await client.connect();
        } catch (err) {
            logger.error('[DB_CONFIG] Failed to connect to Redis on explicit connectRedis call:', err);
            // Decide if this is a critical failure or just a warning if Redis is optional
        }
    } else if (!client) {
        logger.info('[DB_CONFIG] Redis not configured, skipping connection.');
    }
};


// Exporting the client directly as in your original code, and the connect function
module.exports = {
  connectMongoDB,
  redisClient: getRedisClient(), // Provides the instance, services will need to ensure it's connected
  connectRedis, // For explicit connection during startup
};