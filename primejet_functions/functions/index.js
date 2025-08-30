// File: functions/index.js (Corrected and Enhanced)

const {onDocumentCreated} = require("firebase-functions/v2/firestore");
const {logger} = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");

admin.initializeApp();

exports.onNewChatMessage = onDocumentCreated(
    "chats/{chatId}/messages/{messageId}",
    async (event) => {
        const {chatId} = event.params;
        const messageData = event.data.data();
        const db = admin.firestore();

        const chatRef = db.collection("chats").doc(chatId);
        try {
            // This part is excellent, no changes needed here.
            await chatRef.update({
                lastMessage: {
                    text: messageData.message, // FIX: Field is 'message', not 'text'
                    senderId: messageData.senderId,
                },
                lastMessageTimestamp: messageData.timestamp,
                updatedAt: new Date(),
            });
            logger.info(`Successfully updated last message for chat: ${chatId}`);
        } catch (error) {
            logger.error(`Error updating last message for chat ${chatId}:`, error);
        }

        const chatDoc = await chatRef.get();
        if (!chatDoc.exists) {
            logger.warn("Chat document not found for notification.");
            return;
        }

        const chatData = chatDoc.data();
        const participants = chatData.participants;
        const senderId = messageData.senderId;
        const recipientId = participants.find((p) => p !== senderId);

        if (!recipientId) {
            logger.warn(`Recipient not found for chat ${chatId}.`);
            return;
        }

        // <<-- MODIFIED: Securely get sender's name from the chat thread -->>
        const senderName = chatData.participantInfo?.[senderId]?.name || "Someone";

        const NOTIFICATION_ENDPOINT = process.env.API_URL + "/api/v1/fcm/send-notification";
        const API_SECRET_KEY = process.env.API_SECRET;

        if (!NOTIFICATION_ENDPOINT || !API_SECRET_KEY) {
            logger.error("API URL or secret key is not configured.");
            return;
        }

        try {
            await axios.post(
                NOTIFICATION_ENDPOINT,
                {
                    userId: recipientId,
                    // <<-- REPLACED: Use the securely fetched senderName -->>
                    title: `New message from ${senderName}`,
                    body: messageData.message, // FIX: Field is 'message', not 'text'
                    data: {type: "chat_message", orderId: chatId, senderId: senderId},
                },
                {headers: {Authorization: `Bearer ${API_SECRET_KEY}`}},
            );
            logger.info(`Successfully triggered push notification to ${recipientId}.`);
        } catch (error) {
            logger.error(
                "Error calling backend for push notification:",
                error.response ? error.response.data : error.message,
            );
        }
    });