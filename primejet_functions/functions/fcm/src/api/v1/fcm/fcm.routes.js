// File: src/api/v1/fcm/fcm.routes.js

const express = require('express');
const fcmController = require('./fcm.controller');
const HttpError = require('../../../utils/HttpError');

const router = express.Router();

/**
 * Middleware to authenticate requests coming from our Firebase Cloud Function.
 */
const authMiddlewareForFunctions = (req, res, next) => {
  const secretKey = process.env.FUNCTIONS_SECRET_KEY;
  const authHeader = req.headers.authorization;

  if (!secretKey) {
      console.error("FUNCTIONS_SECRET_KEY is not set on the server.");
      return next(new HttpError(500, 'Server configuration error.'));
  }

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new HttpError(401, 'Unauthorized: Missing or invalid token.'));
  }

  const token = authHeader.split(' ')[1];

  if (token === secretKey) {
    // The secret key matches, proceed to the controller
    return next();
  } else {
    // The secret key does not match
    return next(new HttpError(403, 'Forbidden: Invalid secret key.'));
  }
};

// Define the route, protected by our middleware
router.post('/send-notification', authMiddlewareForFunctions, fcmController.sendNotification);

module.exports = router;