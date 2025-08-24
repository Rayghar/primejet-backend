// File: src/api/v1/fcm/fcm.controller.js

const fcmService = require('./fcm.service');
const { logger } = require('../../../config/logger.config');

/**
 * Controller to handle requests for sending push notifications.
 */
const sendNotification = async (req, res) => {
  const { userId, title, body, data } = req.body;

  if (!userId || !title || !body) {
    return res.status(400).json({ error: 'Missing required fields: userId, title, body.' });
  }

  try {
    logger.info(`[FCM_CONTROLLER] Received request to send notification to user: ${userId}`);
    // Asynchronously call the service but don't wait for it.
    // This makes the Cloud Function get a fast response.
    fcmService.sendPushNotification(userId, title, body, data);

    // Immediately respond with success
    res.status(202).json({ message: 'Notification request accepted.' });
  } catch (error) {
    logger.error(`[FCM_CONTROLLER] Error processing notification request: ${error.message}`);
    // This will likely not be hit due to the async call, but is good practice.
    res.status(500).json({ error: 'Failed to process notification request.' });
  }
};

module.exports = {
  sendNotification,
};