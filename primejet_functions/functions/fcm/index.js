const functions = require('firebase-functions');
const express = require('express');

const { initializeFirebase } = require('../../../src/config/firebase.config.js');
const fcmRouter = require('../../../src/api/v1/fcm/fcm.routes.js');

const app = express();
initializeFirebase(); // Initialize Firebase Admin SDK
app.use(express.json());

// Expose only the FCM routes
app.use('/', fcmRouter);

// Deploy this Express app as a Cloud Function
exports.fcmApi = functions.https.onRequest(app);