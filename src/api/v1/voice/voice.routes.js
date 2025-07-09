// File: src/api/v1/voice/voice.routes.js
const express = require('express');
const voiceController = require('./voice.controller');
const authMiddleware = require('../../../middleware/auth.middleware');
const validate = require('../../../middleware/validate.middleware');
const { generateTokenSchema } = require('./voice.validation');

const router = express.Router();

console.log('[VOICE_ROUTES] Registering Agora voice routes...');

router.post(
  '/agora-token',
  authMiddleware(), // Authentication is required to get a token
  validate(generateTokenSchema),
  voiceController.generateAgoraToken
);

console.log('[VOICE_ROUTES] Agora voice routes registered.');

module.exports = router;