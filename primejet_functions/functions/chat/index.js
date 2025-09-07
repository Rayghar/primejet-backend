// File: functions/chat/index.js
const { onRequest } = require("firebase-functions/v2/https");

let chatApp;

exports.chatApi = onRequest({ timeoutSeconds: 300, memory: "1GiB" }, (req, res) => {
  // Check if the app has been initialized
  if (!chatApp) {
    console.log("Initializing Chat App for the first time...");

    // Defer all imports until the first request
    const express = require("express");
    const { initializeFirebase } = require("../../../src/config/firebase.config.js");
    const chatRouter = require("../../../src/api/v1/chat/chat.routes.js");

    // Create the app and initialize everything
    chatApp = express();
    initializeFirebase();
    chatApp.use(express.json());
    chatApp.use("/", chatRouter);
    
    console.log("Chat App Initialized.");
  }

  // Route the request to the now-initialized Express app
  return chatApp(req, res);
});