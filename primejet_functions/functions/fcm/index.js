// File: functions/fcm/index.js
const { onRequest } = require("firebase-functions/v2/https");

let fcmApp;

exports.fcmApi = onRequest({ timeoutSeconds: 300, memory: "1GiB" }, (req, res) => {
  // Check if the app has been initialized
  if (!fcmApp) {
    console.log("Initializing FCM App for the first time...");

    // Defer all imports until the first request
    const express = require("express");
    const { initializeFirebase } = require("../../../src/config/firebase.config.js");
    const fcmRouter = require("../../../src/api/v1/fcm/fcm.routes.js");

    // Create the app and initialize everything
    fcmApp = express();
    initializeFirebase();
    fcmApp.use(express.json());
    fcmApp.use("/", fcmRouter);

    console.log("FCM App Initialized.");
  }

  // Route the request to the now-initialized Express app
  return fcmApp(req, res);
});