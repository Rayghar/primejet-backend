// src/config/firebase.config.js

const admin = require('firebase-admin'); // Import the admin instance (assumed to be initialized elsewhere)
const { logger } = require('./logger.config');

// DO NOT initialize admin.initializeApp() here. It is handled in src/config/index.js.
// This file just provides convenient access to Firebase services after initialization.

let firestoreInstance;
let storageInstance;

// We check if admin.apps is empty AFTER this module is loaded and if the
// Firebase Admin SDK hasn't been initialized by index.js yet.
// If your application is structured correctly (server.js awaits loadConfig()),
// then when this module is used, admin.apps[0] should exist.
if (!admin.apps.length) {
    logger.error("[FIREBASE_CONFIG] FATAL: Firebase Admin SDK was NOT initialized when firebase.config.js was loaded. Ensure loadConfig() is awaited before this module is used.");
    // In production, you might want to exit the process here, as Firebase is likely critical.
    // process.exit(1);
} else {
    try {
        firestoreInstance = admin.firestore();
        storageInstance = admin.storage(); // If you use Firebase Storage
        logger.info('[FIREBASE_CONFIG] Firestore and Storage services accessed.');
    } catch (error) {
        logger.error('[FIREBASE_CONFIG] ERROR: Failed to access Firestore or Storage after SDK init:', error.message);
        // This might happen if init failed in index.js but app continued.
    }
}

module.exports = {
  admin, // Export the admin instance itself (for advanced use, typically not needed directly)
  firestore: firestoreInstance, // Export the firestore instance
  storage: storageInstance, // Export storage if used
  isFirebaseInitialized: admin.apps.length > 0, // A simple check if the app is initialized
};