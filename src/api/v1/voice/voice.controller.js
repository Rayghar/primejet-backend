// File: src/api/v1/voice/voice.controller.js
const voiceService = require('./voice.service');
const HttpError = require('../../../utils/HttpError');

const generateAgoraToken = async (req, res, next) => {
  try {
    const { channelName } = req.body;
    const userId = req.user.id; // From authMiddleware, the current authenticated user's ID

    if (!channelName) {
        throw new HttpError(400, 'Channel name is required.');
    }

    const token = voiceService.generateAgoraRtcToken(channelName, userId);

    res.status(200).json({ token });
  } catch (error) {
    next(error); // Pass error to global error handler
  }
};

module.exports = {
  generateAgoraToken,
};