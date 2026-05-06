// File: src/config/index.js
const dotenv = require('dotenv');
const path = require('path');

// Load .env file from the project root directory
// __dirname here is src/config, so ../../ goes to project root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 3000, // Ensure port is a number
  mongo: {
    uri: process.env.MONGO_URI || (process.env.NODE_ENV === 'production' ? undefined : 'mongodb://127.0.0.1:27017/primejet_dev'),
  },
  jwt: {
    secret: process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? undefined : 'dev_only_change_me_local_secret'),
    expiresIn: process.env.JWT_EXPIRES_IN || '1d',
  },
  redis: {
    url: process.env.REDIS_URL,
  },
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID,
    // Path to credentials file (relative to project root)
    // serviceAccountPath: process.env.GOOGLE_APPLICATION_CREDENTIALS || './firebase-credentials.json',
  },
  sentry: {
    dsn: process.env.SENTRY_DSN,
  },
  defaultCurrency: process.env.DEFAULT_CURRENCY || 'NGN',
  frontendUrl: process.env.FRONTEND_URL || (process.env.NODE_ENV === 'production' ? undefined : 'http://localhost:3001'), // For password reset links etc.
  activePaymentGateway: process.env.DEFAULT_PAYMENT_GATEWAY || 'stripe',
  logLevel: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  // ✅ NEW: Socket.IO configuration
  socket: {
    // This allows the Socket.IO server to accept connections from the specified frontend URL.
    cors: {
      origin: process.env.FRONTEND_URL || (process.env.NODE_ENV === 'production' ? undefined : 'http://localhost:3001'),
      methods: ["GET", "POST"]
    },
    // The path the Socket.IO server will listen on.
    path: '/socket.io',
    // The polling interval in milliseconds. Defaults to 5 seconds.
    pingInterval: 10000, 
    // The ping timeout in milliseconds. Defaults to 5 seconds.
    pingTimeout: 5000, 
  },
};

const { requireProductionEnv } = require('../utils/productionSafety');

// Validate essential configurations. In production, fail fast rather than silently
// starting with unsafe defaults. Development remains convenient for local work.
requireProductionEnv(config);
if (!config.jwt.secret) {
  console.warn('[CONFIG_WARN] JWT_SECRET is not set. Authentication will fail until configured.');
}
if (!config.mongo.uri) {
  console.warn('[CONFIG_WARN] MONGO_URI is not set. Database connection will fail until configured.');
}

/**
 * Updates the active gateway in the running application instance.
 * @param {string} gatewayName - The name of the gateway ('stripe', 'paystack', etc.).
 * @returns {boolean} - True if successful, false if the gateway is not supported.
 */
const setActiveGateway = (gatewayName) => {
  const supportedGateways = ['stripe', 'paystack', 'monnify'];
  if (supportedGateways.includes(gatewayName)) {
    config.activePaymentGateway = gatewayName;
    console.log(`[CONFIG] Active payment gateway has been switched to: ${gatewayName}`);
    return true;
  }
  return false;
};

module.exports = {
  ...config,
  setActiveGateway,
};