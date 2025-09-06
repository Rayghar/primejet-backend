// The Cloud Functions for Firebase SDK to create Cloud Functions and set up triggers.
const functions = require('firebase-functions');

// The Firebase Admin SDK to access Firestore and other Firebase services.
const { initializeFirebase } = require('./src/config/firebase.config.js');

// Initialize Firebase Admin SDK
initializeFirebase();

// Express app setup
const app = require('./src/app.js');

// Expose the Express app as a single Cloud Function
exports.api = functions.https.onRequest(app);