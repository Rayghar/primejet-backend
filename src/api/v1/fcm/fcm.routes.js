// routes/fcm.routes.js
const express = require('express');
const router = express.Router();

// NOTE: adjust the auth path only if your middleware lives elsewhere
const auth = require('../../../middleware/auth.middleware');

// Controller exports below match the names we use here
const {
  updateToken, // Changed from registerToken to reflect the new route
  // unregisterToken can be kept if you have a logout flow that uses it
} = require('./fcm.controller');

// ✅ FIX: Changed the route to match what the Flutter app (api_service.dart) is calling.
// The frontend calls `PUT /api/v1/fcm/token`. This now matches that exactly.
router.put('/token', auth(), updateToken);


// This route can be kept for handling token removal on logout, if implemented.
// If your app's logout process calls POST /unregister, this is correct.
// router.post('/unregister', auth(), unregisterToken);


module.exports = router;