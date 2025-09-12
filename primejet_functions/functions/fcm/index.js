// File: functions/fcm/index.js

const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const admin = require("firebase-admin");

// 1. Define all secrets needed by this codebase
const mongoDbUri = defineSecret("MONGODB_URI");
const apiSecret = defineSecret("API_SECRET");

// 2. Initialize Firebase Admin SDK and use a lazy-initialized app/db connection
admin.initializeApp();
let app;
let User; // To store the User model after DB connection

// -----------------------------------------------------------------------------
// REUSABLE HELPER FUNCTION 🛠️
// -----------------------------------------------------------------------------
// Both functions will use this core logic to send notifications.
const sendNotification = async (userId, title, body, data = {}) => {
    if (!User) {
        console.error("User model is not initialized. Cannot send notification.");
        return;
    }
    
    try {
        const user = await User.findOne({ id: userId }).select('fcmTokens').lean();

        if (!user || !user.fcmTokens || user.fcmTokens.length === 0) {
            console.log(`User ${userId} has no FCM tokens. Skipping.`);
            return;
        }

        const message = {
            notification: { title, body },
            data: { ...data, click_action: 'FLUTTER_NOTIFICATION_CLICK' },
            tokens: user.fcmTokens,
        };

        const response = await admin.messaging().sendMulticast(message);
        console.log(`Sent notification to user ${userId}. Success: ${response.successCount}, Failure: ${response.failureCount}`);

        // Logic to clean up invalid tokens
        if (response.failureCount > 0) {
            const tokensToRemove = [];
            response.responses.forEach((result, index) => {
                const error = result.error;
                if (error && (error.code === 'messaging/registration-token-not-registered' || error.code === 'messaging/invalid-registration-token')) {
                    tokensToRemove.push(user.fcmTokens[index]);
                }
            });
            if (tokensToRemove.length > 0) {
                await User.updateOne({ id: userId }, { $pullAll: { fcmTokens: tokensToRemove } });
            }
        }
    } catch (error) {
        console.error(`Critical error sending notification to user ${userId}:`, error);
    }
};

// -----------------------------------------------------------------------------
// HTTP-TRIGGERED FUNCTION 📞
// -----------------------------------------------------------------------------
// For sending custom notifications from your main backend.
exports.fcmApi = onRequest(
    { secrets: [mongoDbUri, apiSecret] },
    async (req, res) => {
        if (!app) {
            console.log("Initializing FCM API for the first time...");
            process.env.API_SECRET = apiSecret.value();
            const MONGODB_URI_VALUE = mongoDbUri.value();

            try {
                await mongoose.connect(MONGODB_URI_VALUE);
                User = mongoose.model('User', new mongoose.Schema({ id: String, fcmTokens: [String] }), 'users');
                console.log("FCM API successfully connected to MongoDB.");
            } catch (error) {
                console.error("FCM API: MongoDB Connection Failed:", error);
                return res.status(500).send("Internal Server Error: Could not connect to the database.");
            }
            
            const authMiddleware = (request, response, next) => { /* Middleware logic from before */ };

            app = express();
            app.use(cors({ origin: true }));
            app.use(express.json());

            app.post("/send-notification", authMiddleware, async (request, response) => {
                const { userId, title, body, data } = request.body;
                if (!userId || !title || !body) {
                    return response.status(400).json({ error: 'Missing required fields.' });
                }
                // Use the helper function to send the notification
                await sendNotification(userId, title, body, data);
                return response.status(202).json({ message: 'Notification request accepted.' });
            });
            console.log("FCM API Initialized.");
        }
        return app(req, res);
    }
);

// -----------------------------------------------------------------------------
// EVENT-TRIGGERED FUNCTION ⚡️
// -----------------------------------------------------------------------------
// For automatically sending chat notifications.
exports.onNewChatMessage = onDocumentCreated(
    { document: "chats/{chatId}/messages/{messageId}", secrets: [mongoDbUri] },
    async (event) => {
        // Ensure the User model is available
        if (!User) {
            const MONGODB_URI_VALUE = mongoDbUri.value();
            await mongoose.connect(MONGODB_URI_VALUE);
            User = mongoose.model('User', new mongoose.Schema({ id: String, fcmTokens: [String] }), 'users');
        }
        
        const messageData = event.data.data();
        const chatRef = admin.firestore().collection("chats").doc(event.params.chatId);
        
        const chatDoc = await chatRef.get();
        if (!chatDoc.exists) return;
        
        const chatData = chatDoc.data();
        const recipientId = chatData.participants.find((p) => p !== messageData.senderId);
        if (!recipientId) return;

        const senderName = chatData.participantInfo?.[messageData.senderId]?.name || "Someone";

        // Use the same helper function to send the chat notification
        await sendNotification(
            recipientId,
            `New message from ${senderName}`,
            messageData.message,
            { type: "chat_message", orderId: event.params.chatId }
        );
    }
);