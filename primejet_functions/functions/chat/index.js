const functions = require('firebase-functions');
const express = require('express');

// The relative path is crucial here. Your 'src' directory needs to be moved inside 'functions/chat'.
// This is a minimal, standalone Express app for just the chat feature.
const { initializeFirebase } = require('../../../src/config/firebase.config.js');
const chatRouter = require('../../../src/api/v1/chat/chat.routes.js');

const app = express();
initializeFirebase(); // Initialize Firebase Admin SDK
app.use(express.json());

// Expose only the chat routes
app.use('/', chatRouter);

// Deploy this Express app as a Cloud Function
exports.chatApi = functions.https.onRequest(app);