// src/config/firebase.config.js
const admin = require('firebase-admin');
const path = require('path');
const globalConfig = require('./index'); // For FIREBASE_PROJECT_ID etc.
const { logger } = require('./logger.config');

// Path for service account key (relative to this config file's location)
// If firebase-credentials.json is in the project root:
const serviceAccountPath = path.resolve(__dirname, '../../firebase-credentials.json');

let firestoreInstance;
let storageInstance;
let successfullyInitialized = false;

// More robust check for emulator environment
const isEmulator = ['test', 'development'].includes(globalConfig.env) ||
                    process.env.FIRESTORE_EMULATOR_HOST ||
                    process.env.FIREBASE_STORAGE_EMULATOR_HOST ||
                    process.env.FIREBASE_AUTH_EMULATOR_HOST; // Check for any relevant emulator env var

try {
  if (!admin.apps.length) {
    const firebaseAppOptions = {};
    if (isEmulator) {
      logger.info('[FIREBASE_CONFIG] Emulator environment detected. Initializing Firebase Admin SDK for emulators.');
      // When using emulators, service account credentials are often not needed if emulator hosts are set.
      // Project ID is crucial if not using service account.
      if (globalConfig.firebase.projectId) {
        firebaseAppOptions.projectId = globalConfig.firebase.projectId;
      } else {
        logger.warn('[FIREBASE_CONFIG] FIREBASE_PROJECT_ID not set in .env; emulators might require it.');
      }
      // The Admin SDK will automatically connect to emulators if their respective
      // environment variables (FIRESTORE_EMULATOR_HOST, etc.) are set.
    } else {
      logger.info(`[FIREBASE_CONFIG] Production/Staging environment. Loading credentials from: ${serviceAccountPath}`);
      try {
        const serviceAccount = require(serviceAccountPath);
        firebaseAppOptions.credential = admin.credential.cert(serviceAccount);
        if (globalConfig.firebase.projectId) { // Optional: also specify projectId if needed with cert
             firebaseAppOptions.projectId = globalConfig.firebase.projectId;
        }
      } catch (credError) {
        logger.error(`[FIREBASE_CONFIG] CRITICAL: Failed to load Firebase credentials from ${serviceAccountPath}. Firebase will not be initialized. Error: ${credError.message}`);
        throw credError; // Re-throw to prevent app from starting if Firebase is critical
      }
    }
    admin.initializeApp(firebaseAppOptions);
    logger.info('[FIREBASE_CONFIG] Firebase Admin SDK initialized successfully.');
    successfullyInitialized = true;
  } else {
    logger.info('[FIREBASE_CONFIG] Firebase Admin SDK already initialized. Using existing app.');
    successfullyInitialized = true;
  }

  if (successfullyInitialized) {
    firestoreInstance = admin.firestore();
    storageInstance = admin.storage(); // If you use Firebase Storage
    logger.info('[FIREBASE_CONFIG] Firestore and Storage services accessed.');

    if (isEmulator && firestoreInstance && process.env.FIRESTORE_EMULATOR_HOST) {
      // This setting is more for client SDKs. Admin SDK usually auto-detects via env vars.
      // However, some older versions or specific setups might benefit.
      // firestoreInstance.settings({
      //   host: process.env.FIRESTORE_EMULATOR_HOST,
      //   ssl: false,
      // });
      // logger.info(`[FIREBASE_CONFIG] Firestore emulator explicitly targeted at ${process.env.FIRESTORE_EMULATOR_HOST}`);
    }
  }
} catch (error) {
  logger.error('[FIREBASE_CONFIG] CRITICAL: Error during Firebase Admin SDK setup:', error.stack || error.message);
  // Depending on how critical Firebase is, you might want to exit:
  // process.exit(1);
}

module.exports = {
  admin, // Export the admin instance itself
  firestore: firestoreInstance,
  storage: storageInstance, // Export storage if used
  isFirebaseInitialized: successfullyInitialized,
};