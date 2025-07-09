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
    uri: process.env.MONGO_URI || 'MONGO_URI=mongodb+srv://gWEcHdWqXqK6mEiO@cluster0.hefxifh.mongodb.net/primejet?retryWrites=true&w=majority&appName=Cluster0',
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'fallback_super_secret_key_for_dev_only_please_change',
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
  logLevel: process.env.LOG_LEVEL || 'debug', // <<< MODIFIED: Default to 'debug' for local dev
  defaultCurrency: process.env.DEFAULT_CURRENCY || 'NGN',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3001', // For password reset links etc.
  activePaymentGateway: process.env.DEFAULT_PAYMENT_GATEWAY || 'stripe',
  logLevel: process.env.LOG_LEVEL || 'info',
};

// Validate essential configurations
if (!config.jwt.secret || config.jwt.secret === 'fallback_super_secret_key_for_dev_only_please_change') {
  console.warn('[CONFIG_WARN] JWT_SECRET is not set or is using the default fallback. This is insecure for production.');
}
if (!config.mongo.uri || config.mongo.uri === 'mongodb://localhost:27017/primejet_default_dev') {
    console.warn('[CONFIG_WARN] MONGO_URI is not set or is using a default development URI.');
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