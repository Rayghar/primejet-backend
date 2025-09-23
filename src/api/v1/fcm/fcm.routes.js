// routes/fcm.routes.js
const express = require('express');
const router = express.Router();

// NOTE: adjust the auth path only if your middleware lives elsewhere
const auth = require('../../../middleware/auth.middleware');

// Controller exports below match the names we use here
const {
  registerToken,
  unregisterToken,
} = require('./fcm.controller');

// POST /api/v1/fcm/register
router.post('/register', auth, registerToken);

// POST /api/v1/fcm/unregister
router.post('/unregister', auth, unregisterToken);

module.exports = router;
