const admin = require('firebase-admin');
const { logger } = require('./logger.config.js');

// A flag to ensure we only initialize once
let isFirebaseInitialized = false;

function initializeFirebase() {
  if (isFirebaseInitialized) {
    return;
  }
  
  try {
    // When deployed to Google Cloud, initializeApp() with no arguments
    // automatically finds the project's service account credentials.
    // This is the standard and secure way to initialize.
    admin.initializeApp();
    
    isFirebaseInitialized = true;
    logger.info('[FIREBASE_CONFIG] Firebase Admin SDK initialized successfully in the cloud environment.');
  } catch (error) {
    logger.error('[FIREBASE_CONFIG] Firebase Admin SDK initialization error:', {
      message: error.message,
      stack: error.stack,
    });
    // Re-throw the error to ensure the function fails clearly if initialization is impossible.
    throw new Error('Could not initialize Firebase Admin SDK.');
  }
}

module.exports = {
  admin,
  firestore: () => admin.firestore(),
  isFirebaseInitialized,
  initializeFirebase,
};