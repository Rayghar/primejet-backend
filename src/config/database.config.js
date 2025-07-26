// src/config/database.config.js

const mongoose = require('mongoose');
const Redis = require('redis');
// REMOVED: const globalConfig = require('./index'); // No longer directly importing config here
const { logger } = require('./logger.config'); // Load logger for DB events

mongoose.set('strictQuery', true);

/**
 * Connects to MongoDB using the provided URI.
 * @param {string} mongoUri - The MongoDB connection URI.
 */
const connectMongoDB = async (mongoUri) => { // Accept mongoUri as parameter
  try {
    if (!mongoUri) {
      logger.error('[DB_CONFIG] MongoDB URI is not provided. Cannot connect to database.');
      throw new Error('MongoDB URI missing');
    }
    logger.info(`[DB_CONFIG] Attempting to connect to MongoDB...`); // Don't log URI itself
    await mongoose.connect(mongoUri, { // Use the passed mongoUri
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
    throw error; // Re-throw to be caught by server.js startup
  }
};

let redisClientInstance;

/**
 * Gets or creates the Redis client instance.
 * @param {string} redisUrl - The Redis connection URL.
 * @returns {RedisClientType | null} The Redis client instance or null if not configured.
 */
const getRedisClient = (redisUrl) => {
  if (redisClientInstance && redisClientInstance.isOpen) {
    return redisClientInstance;
  }
  if (redisUrl) { // Check for redisUrl parameter
     redisClientInstance = Redis.createClient({
       url: redisUrl,
     });

     redisClientInstance.on('error', (err) => logger.error(`Redis Client Error: ${err}`));
     redisClientInstance.on('connect', () => logger.info('Redis connected successfully.'));
     redisClientInstance.on('reconnecting', () => logger.warn('Redis reconnecting...'));
     redisClientInstance.on('end', () => logger.info('Redis connection ended.'));
     
     return redisClientInstance;
  }
  logger.warn('Redis URL not configured. Redis client not created.');
  return null; // Return null if not configured
};

/**
 * Explicitly connects the Redis client during startup.
 * @param {string} redisUrl - The Redis connection URL.
 */
const connectRedis = async (redisUrl) => { // Accept redisUrl as parameter
    const client = getRedisClient(redisUrl); // Pass URL to getRedisClient
    if (client && !client.isOpen) { 
        try {
            await client.connect();
            logger.info('[DB_CONFIG] Redis connected successfully on explicit connectRedis call.');
        } catch (err) {
            logger.error('[DB_CONFIG] Failed to connect to Redis on explicit connectRedis call:', err);
        }
    } else if (!client) {
        logger.info('[DB_CONFIG] Redis not configured, skipping connection.');
    }
};


// Exporting the client directly as in your original code, and the connect function
module.exports = {
  connectMongoDB,
  // MODIFIED: redisClient is now accessed through a function call in server.js
  // that provides the URL, or it needs to be made available differently if other modules
  // directly import and use it before connectRedis is called.
  // For simplicity, we can export the instance from here if it's initialized,
  // but ensure it's accessed AFTER connectRedis is awaited.
  // Re-evaluating: The redisClient is now created by getRedisClient(redisUrl).
  // server.js checks `if (redisClient && redisClient.isOpen)`.
  // To make `redisClient` available in graceful shutdown, we can pass it, or
  // `getRedisClient()` can set a module-scoped variable `redisClientInstance`
  // which is then exported.
  redisClient: redisClientInstance, // This will be null until getRedisClient is called with a URL
  connectRedis, 
  getRedisClient // Export this too so it can be called elsewhere if needed
};