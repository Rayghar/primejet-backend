// routes/fcm.routes.js
const express = require('express');
const router = express.Router();

const auth = require('../../../middleware/auth.middleware');

// ✅ FIX: Import only the functions that are actually used.
const {
  registerToken,
  unregisterToken,
} = require('./fcm.controller');

// This is the correct route that your Flutter app is calling.
// POST /api/v1/fcm/register
router.post('/register', auth(), registerToken);

// This route is for handling token removal on user logout.
// POST /api/v1/fcm/unregister
router.post('/unregister', auth(), unregisterToken);

// ❌ REMOVED: The old, unused PUT /token route has been deleted.

module.exports = router;