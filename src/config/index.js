// File: src/config/index.js

const path = require('path');
const admin = require('firebase-admin'); // Assuming you use firebase-admin in your app
const dotenv = require('dotenv'); // Keep dotenv for local development
const winston = require('winston'); // Added to define winston module
// Load environment variables from .env file for local development
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Initialize logger with a basic configuration to avoid circular dependency
const { createLogger } = require('winston');
const basicLogger = createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} ${level}: ${message}`)
  ),
  transports: [new winston.transports.Console()],
});

// Asynchronously loads configuration from process.env and constructs the config object
async function loadConfig() {
  // Set default NODE_ENV if not provided
  process.env.NODE_ENV = process.env.NODE_ENV || 'development';

  basicLogger.info(`INFO: Running in ${process.env.NODE_ENV} mode. Loading configuration...`);

  // Initialize Firebase Admin SDK using environment variables
  if (!admin.apps.length) { // Check if Firebase Admin SDK is not already initialized
    try {
      const firebaseCredentialsB64 = process.env.FIREBASE_CREDENTIALS_JSON_B64;
      const firebaseProjectId = process.env.FIREBASE_PROJECT_ID;
      const databaseURL = process.env.FIREBASE_DATABASE_URL;

      if (process.env.NODE_ENV === 'development' && process.env.FIREBASE_CREDENTIALS_PATH) {
        const serviceAccount = require(path.resolve(__dirname, '../../' + process.env.FIREBASE_CREDENTIALS_PATH));
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          databaseURL: databaseURL || `https://${firebaseProjectId}.firebaseio.com`
        });
        basicLogger.info('INFO: Firebase Admin SDK initialized from local file (development mode).');
      } else if (firebaseCredentialsB64 && firebaseProjectId) {
        const decodedCredentials = Buffer.from(firebaseCredentialsB64, 'base64').toString('utf8');
        const serviceAccount = JSON.parse(decodedCredentials);
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          databaseURL: databaseURL || `https://${firebaseProjectId}.firebaseio.com`
        });
        basicLogger.info('INFO: Firebase Admin SDK initialized successfully from base64 environment variable.');
      } else {
        basicLogger.warn('WARN: Firebase credentials not provided. Firebase Admin SDK not initialized.');
      }
    } catch (error) {
      basicLogger.error('ERROR: Failed to initialize Firebase Admin SDK:', error);
      // Allow the app to proceed without Firebase if initialization fails
    }
  }

  const finalConfig = {
    env: process.env.NODE_ENV,
    port: parseInt(process.env.PORT, 10) || 3000,
    mongo: {
      uri: process.env.MONGO_URI,
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
    },
    sentry: {
      dsn: process.env.SENTRY_DSN,
    },
    logLevel: process.env.LOG_LEVEL || 'info',
    defaultCurrency: process.env.DEFAULT_CURRENCY || 'NGN',
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3001',
    activePaymentGateway: process.env.DEFAULT_PAYMENT_GATEWAY || 'stripe',
    flutterwavePublicKey: process.env.FLUTTERWAVE_PUBLIC_KEY,
    paystackPublicKey: process.env.PAYSTACK_PUBLIC_KEY,
    googleMapsApiKey: process.env.Maps_API_KEY, // Corrected to Maps_API_KEY
    prometheusPort: parseInt(process.env.PROMETHEUS_PORT, 10) || 9090,
    sendgridFromEmail: process.env.SENDGRID_FROM_EMAIL,
    googleClientId: process.env.GOOGLE_CLIENT_ID,
    googleAndroidClientId: process.env.GOOGLE_ANDROID_CLIENT_ID,
    googleIosClientId: process.env.GOOGLE_IOS_CLIENT_ID,
    monnifyContractCode: process.env.MONNIFY_CONTRACT_CODE,
    monnifyBaseUrl: process.env.MONNIFY_BASE_URL,
    opayMerchantId: process.env.OPAY_MERCHANT_ID,
    opayPublicKey: process.env.OPAY_PUBLIC_KEY,
    opayBaseUrl: process.env.OPAY_BASE_URL,
    iswMerchantId: process.env.ISW_MERCHANT_ID,
    iswDomainId: process.env.ISW_DOMAIN_ID,
    iswLiveMode: process.env.ISW_LIVE_MODE === 'true',
  };

  if (!finalConfig.jwt.secret || finalConfig.jwt.secret === 'fallback_super_secret_key_for_dev_only_please_change') {
    basicLogger.warn('[CONFIG_WARN] JWT_SECRET is not set from environment variables or is using the fallback. This is insecure for production.');
  }
  if (!finalConfig.mongo.uri || finalConfig.mongo.uri.includes('localhost') || finalConfig.mongo.uri.includes('primejet_default_dev')) {
    basicLogger.warn('[CONFIG_WARN] MONGO_URI is not set from environment variables or is using a development URI. Check App Runner env vars.');
  }
  if (finalConfig.env === 'production' && (!finalConfig.sentry || !finalConfig.sentry.dsn)) {
    basicLogger.warn('[CONFIG_WARN] Sentry DSN is required in production but not set.');
  }

  return finalConfig;
}

const setActiveGateway = (gatewayName) => {
  const supportedGateways = ['stripe', 'paystack', 'monnify'];
  if (supportedGateways.includes(gatewayName)) {
    basicLogger.warn("WARN: setActiveGateway only modifies the in-memory config, not the environment variable. Use with caution.");
    return false; 
  }
  return false;
};

module.exports = {
  loadConfig,
  setActiveGateway
};