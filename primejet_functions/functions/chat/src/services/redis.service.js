// src/services/redis.service.js
// Assuming redisClient and connectRedis (optional here) are exported from database.config.js
const { redisClient } = require('../config/database.config.js');
const { logger } = require('../config/logger.config.js'); // For logging

/**
 * Checks if the Redis client is available and connected.
 * @returns {boolean} True if connected, false otherwise.
 */
const isRedisConnected = () => {
  if (!redisClient) {
    logger.warn('[REDIS_SERVICE] Redis client is not initialized. Check Redis configuration.');
    return false;
  }
  if (!redisClient.isOpen) { // redis v4 uses isOpen, v3 used isConnected or connected
    logger.warn('[REDIS_SERVICE] Redis client is not connected. Caching operations will be skipped.');
    // You might attempt a reconnect here if appropriate, but generally connection
    // should be managed at application startup (e.g., in server.js via connectRedis).
    return false;
  }
  return true;
};

/**
 * Caches data in Redis with an expiry time.
 * @param {string} key - The key under which to store the data.
 * @param {any} data - The data to cache (will be JSON.stringified).
 * @param {number} [expiryInSeconds=3600] - The expiry time in seconds.
 * @returns {Promise<boolean>} True if caching was successful, false otherwise.
 */
const cacheData = async (key, data, expiryInSeconds = 3600) => {
  if (!isRedisConnected()) {
    return false;
  }
  try {
    const jsonData = JSON.stringify(data);
    await redisClient.setEx(key, expiryInSeconds, jsonData);
    logger.debug(`[REDIS_SERVICE] Data cached successfully for key: ${key}`);
    return true;
  } catch (error) {
    logger.error(`[REDIS_SERVICE] Error caching data for key ${key}:`, error);
    return false; // Do not let Redis errors crash the main application flow if caching is non-critical
  }
};

/**
 * Retrieves cached data from Redis.
 * @param {string} key - The key of the data to retrieve.
 * @returns {Promise<any|null>} The parsed data, or null if not found or an error occurs.
 */
const getCachedData = async (key) => {
  if (!isRedisConnected()) {
    return null;
  }
  try {
    const jsonData = await redisClient.get(key);
    if (jsonData) {
      logger.debug(`[REDIS_SERVICE] Data retrieved from cache for key: ${key}`);
      return JSON.parse(jsonData);
    }
    logger.debug(`[REDIS_SERVICE] No data found in cache for key: ${key}`);
    return null;
  } catch (error) {
    logger.error(`[REDIS_SERVICE] Error retrieving cached data for key ${key}:`, error);
    return null;
  }
};

/**
 * Clears cached data from Redis for a specific key or pattern of keys.
 * @param {string | string[]} keyOrPattern - A single key, an array of keys, or a pattern (e.g., 'users:*').
 * If using patterns, ensure your Redis server version supports it for DEL
 * or implement a KEYS + DEL approach carefully.
 * @returns {Promise<boolean>} True if clearing was attempted, false if Redis is not connected.
 */
const clearCache = async (keyOrPattern) => {
  if (!isRedisConnected()) {
    return false;
  }
  try {
    if (Array.isArray(keyOrPattern)) {
        if (keyOrPattern.length === 0) return true;
        await redisClient.del(keyOrPattern);
        logger.info(`[REDIS_SERVICE] Cache cleared for keys: ${keyOrPattern.join(', ')}`);
    } else if (keyOrPattern.includes('*')) { // Basic wildcard check for pattern
        logger.warn(`[REDIS_SERVICE] Attempting to clear cache with pattern: ${keyOrPattern}. Ensure your Redis setup handles this efficiently (KEYS can be blocking).`);
        const keys = await redisClient.keys(keyOrPattern);
        if (keys.length > 0) {
            await redisClient.del(keys);
            logger.info(`[REDIS_SERVICE] Cache cleared for ${keys.length} keys matching pattern: ${keyOrPattern}`);
        } else {
            logger.info(`[REDIS_SERVICE] No keys found matching pattern: ${keyOrPattern}`);
        }
    }
    else {
        await redisClient.del(keyOrPattern);
        logger.info(`[REDIS_SERVICE] Cache cleared for key: ${keyOrPattern}`);
    }
    return true;
  } catch (error) {
    logger.error(`[REDIS_SERVICE] Error clearing cache for key/pattern ${keyOrPattern}:`, error);
    return false;
  }
};

/**
 * Flushes all data from the current Redis database.
 * Use with extreme caution, especially in production.
 * @returns {Promise<boolean>} True if flush was successful, false otherwise.
 */
const flushAllCache = async () => {
    if (!isRedisConnected()) {
        logger.error('[REDIS_SERVICE] Cannot flush all cache, Redis not connected.');
        return false;
    }
    if (process.env.NODE_ENV === 'production') {
        logger.error('[REDIS_SERVICE] FLUSHALL command is disabled in production environment by this service logic.');
        throw new HttpError(500, 'Cache flushall is disabled in production.');
    }
    try {
        await redisClient.flushAll(); // Or FLUSHDB for current DB
        logger.warn('[REDIS_SERVICE] All cache flushed from Redis (FLUSHALL executed).');
        return true;
    } catch (error) {
        logger.error('[REDIS_SERVICE] Error flushing all cache:', error);
        return false;
    }
};


module.exports = {
  cacheData,
  getCachedData,
  clearCache,
  flushAllCache, // Added for completeness, use with caution
  isRedisConnected, // Exporting the check function can be useful
};