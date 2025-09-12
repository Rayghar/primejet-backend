// File: functions/chat/index.js

const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const admin = require("firebase-admin");
// --- MOVED --- The chatRouter is no longer required at the top level.

const jwtSecret = defineSecret("JWT_SECRET");
const mongoDbUri = defineSecret("MONGODB_URI");

let app;

exports.chatApi = onRequest(
    { secrets: [jwtSecret, mongoDbUri] },
    async (req, res) => {
        if (!app) {
            console.log("Initializing Chat API for the first time...");

            // Initialize Firebase Admin SDK
            if (!admin.apps.length) {
                admin.initializeApp();
                console.log("Firebase Admin SDK Initialized.");
            }

            // Set environment variable for middleware
            process.env.JWT_SECRET = jwtSecret.value();
            const MONGODB_URI_VALUE = mongoDbUri.value();

            // Connect to MongoDB
            try {
                await mongoose.connect(MONGODB_URI_VALUE);
                console.log("Successfully connected to MongoDB.");
            } catch (error) {
                console.error("MongoDB Connection Failed:", error);
                return res.status(500).send("Internal Server Error: Could not connect to the database.");
            }
            
            // ✅ LAZY-LOAD THE ROUTER HERE
            // This prevents a timeout during deployment analysis.
            const chatRouter = require("./src/api/v1/chat/chat.routes.js");

            // Create and configure the Express app
            app = express();
            app.use(cors({ origin: true }));
            app.use(express.json());
            app.use("/api/v1/chat", chatRouter);

            console.log("Chat API Initialized and ready to serve requests.");
        }
        return app(req, res);
    },
);