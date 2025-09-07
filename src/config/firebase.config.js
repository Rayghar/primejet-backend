// src/config/firebase.config.js

const admin = require('firebase-admin');
const path = require('path');
const globalConfig = require('./index');
const { logger } = require('./logger.config');

const serviceAccountPath = path.resolve(__dirname, '../../firebase-credentials.json');

let firestoreInstance;
let storageInstance;
let successfullyInitialized = false;

const isEmulator = ['test', 'development'].includes(globalConfig.env) ||
                    process.env.FIRESTORE_EMULATOR_HOST ||
                    process.env.FIREBASE_STORAGE_EMULATOR_HOST ||
                    process.env.FIREBASE_AUTH_EMULATOR_HOST;

const initializeFirebase = () => {
  if (!admin.apps.length) {
    const firebaseAppOptions = {};
    if (isEmulator) {
      logger.info('[FIREBASE_CONFIG] Emulator environment detected. Initializing Firebase Admin SDK for emulators.');
      if (globalConfig.firebase.projectId) {
        firebaseAppOptions.projectId = globalConfig.firebase.projectId;
      } else {
        logger.warn('[FIREBASE_CONFIG] FIREBASE_PROJECT_ID not set in .env; emulators might require it.');
      }
    } else {
      logger.info(`[FIREBASE_CONFIG] Production/Staging environment. Loading credentials from: ${serviceAccountPath}`);
      try {
        const serviceAccount = require(serviceAccountPath);
        firebaseAppOptions.credential = admin.credential.cert(serviceAccount);
        if (globalConfig.firebase.projectId) {
             firebaseAppOptions.projectId = globalConfig.firebase.projectId;
        }
      } catch (credError) {
        logger.error(`[FIREBASE_CONFIG] CRITICAL: Failed to load Firebase credentials from ${serviceAccountPath}. Firebase will not be initialized. Error: ${credError.message}`);
        throw credError;
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
    storageInstance = admin.storage();
    logger.info('[FIREBASE_CONFIG] Firestore and Storage services accessed.');
  }
};

module.exports = {
  admin,
  firestore: firestoreInstance,
  storage: storageInstance,
  isFirebaseInitialized: successfullyInitialized,
  initializeFirebase, // <-- FIX: Add the function to the exports
};