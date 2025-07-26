// File: src/config/index.js

const path = require('path');
const admin = require('firebase-admin'); // Assuming you use firebase-admin in your app
const dotenv = require('dotenv'); // Keep dotenv for local development

// --- CONFIGURATION FOR ENVIRONMENT VARIABLES ---
const AWS_REGION = process.env.AWS_REGION || "us-east-1"; 

/**
 * Initializes Firebase Admin SDK from base64 encoded credentials in environment variable.
 * This function is called by loadConfig.
 */
function initializeFirebaseAdmin(firebaseCredentialsB64, firebaseProjectId, databaseURL) {
  if (admin.apps.length > 0) { // Check if Firebase Admin SDK is ALREADY initialized
    console.log("INFO: Firebase Admin SDK already initialized.");
    return;
  }
  if (!firebaseCredentialsB64) {
    console.warn("WARN: FIREBASE_CREDENTIALS_JSON_B64 not found. Firebase Admin SDK might not initialize.");
    return;
  }

  try {
    const decodedCredentials = Buffer.from(firebaseCredentialsB64, 'base64').toString('utf8');
    const serviceAccount = JSON.parse(decodedCredentials);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: databaseURL || `https://${firebaseProjectId}.firebaseio.com`
    });
    console.log("INFO: Firebase Admin SDK initialized successfully from base64 environment variable.");
  } catch (error) {
    console.error("ERROR: Failed to decode or initialize Firebase from base64 env var:", error);
    throw new Error(`Firebase initialization error: ${error.message}`);
  }
}

/**
 * Asynchronously loads configuration from process.env and constructs the config object.
 * This function should be awaited when imported.
 * @returns {Promise<object>} The fully loaded configuration object.
 */
async function loadConfig() {
  // First, load .env file for local development. In production, App Runner
  // environment variables will override these.
  dotenv.config({ path: path.resolve(__dirname, '../../.env') }); 

  process.env.NODE_ENV = process.env.NODE_ENV || 'development';

  if (process.env.NODE_ENV === 'production') {
    console.log("INFO: Loading production configuration directly from environment variables...");
    delete process.env.FIREBASE_EMULATOR;
    delete process.env.FIRESTORE_EMULATOR_HOST;
    console.log("INFO: Firebase emulator settings removed for production.");
  } else {
    console.log(`INFO: Running in development mode (NODE_ENV=${process.env.NODE_ENV}). Loading from .env file.`);
    // If you use a local firebase-credentials.json in development, you can keep that logic here
    // This condition checks if it's development AND Firebase Admin SDK is NOT already initialized
    // and FIREBASE_CREDENTIALS_PATH is set (from .env).
    if (process.env.FIREBASE_CREDENTIALS_PATH && !admin.apps.length) { 
      try {
        const serviceAccount = require(path.resolve(__dirname, '../../' + process.env.FIREBASE_CREDENTIALS_PATH));
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          databaseURL: process.env.FIREBASE_DATABASE_URL
        });
        console.log("INFO: Firebase Admin SDK initialized from local file (development mode).");
      } catch (error) {
        console.error("ERROR: Failed to load Firebase credentials from local file (development mode):", error);
        // Do not exit, allow app to run without Firebase if it can
      }
    }
  }

  // Initialize Firebase Admin SDK using the base64 string after process.env is populated
  // This will check admin.apps.length > 0 inside initializeFirebaseAdmin and avoid double init.
  initializeFirebaseAdmin(
    process.env.FIREBASE_CREDENTIALS_JSON_B64,
    process.env.FIREBASE_PROJECT_ID,
    process.env.FIREBASE_DATABASE_URL
  );

  const finalConfig = {
    env: process.env.NODE_ENV, 
    port: parseInt(process.env.PORT, 10) || 3000,
    mongo: {
      uri: process.env.MONGO_URI, 
    },
    jwt: {
      secret: process.env.JWT_SECRET, 
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
    console.warn('[CONFIG_WARN] JWT_SECRET is not set from environment variables or is using the fallback. This is insecure for production.');
  }
  if (!finalConfig.mongo.uri || finalConfig.mongo.uri.includes('localhost') || finalConfig.mongo.uri.includes('primejet_default_dev')) {
    console.warn('[CONFIG_WARN] MONGO_URI is not set from environment variables or is using a development URI. Check App Runner env vars.');
  }
  if (finalConfig.env === 'production' && (!finalConfig.sentry || !finalConfig.sentry.dsn)) {
    console.warn('[CONFIG_WARN] Sentry DSN is required in production but not set.');
  }

  return finalConfig;
}

const setActiveGateway = (gatewayName) => {
  const supportedGateways = ['stripe', 'paystack', 'monnify'];
  if (supportedGateways.includes(gatewayName)) {
    console.warn("WARN: setActiveGateway only modifies the in-memory config, not the environment variable. Use with caution.");
    return false; 
  }
  return false;
};

module.exports = {
  loadConfig,
  setActiveGateway 
};