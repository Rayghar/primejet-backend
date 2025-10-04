// controllers/fcm.controller.js
const {
  addToken,
  removeToken,
} = require('../../../api/v1/fcm/fcm.service');

/**
 * Handles `POST /fcm/register` to register or update a device's FCM token.
 */
exports.registerToken = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const { token } = req.body || {}; // Correctly reads the 'token' field.
    
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!token) {
      return res.status(400).json({ error: 'token is required' });
    }

    await addToken(userId, token);
    return res.status(200).json({ message: 'Token registered successfully.' });
  } catch (e) {
    return next(e);
  }
};

/**
 * Handles removing a device's FCM token, for example on logout.
 */
exports.unregisterToken = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const { token } = req.body || {};
    
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!token) {
      return res.status(400).json({ error: 'token is required' });
    }

    await removeToken(userId, token);
    return res.status(200).json({ message: 'Token unregistered successfully.' });
  } catch (e) {
    return next(e);
  }
};

