// controllers/fcm.controller.js
// Minimal controller that stores/removes a device token for the authenticated user

const {
  addToken,
  removeToken,
} = require('../../../api/v1/fcm/fcm.service'); // adjust path if your services live elsewhere

/**
 * Handles `PUT /fcm/token` to register or update a device's FCM token.
 */
exports.updateToken = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    // Your api_service.dart sends the token in a field named 'fcmToken'.
    const { fcmToken } = req.body || {}; 
    
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!fcmToken) {
      return res.status(400).json({ error: 'fcmToken is required' });
    }

    await addToken(userId, fcmToken);
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
      return res.status(400).json({ error: 'token required' });
    }

    await removeToken(userId, token);
    return res.status(200).json({ message: 'Token unregistered successfully.' });
  } catch (e) {
    return next(e);
  }
};

/**
 * Handles `POST /fcm/register` to register or update a device's FCM token.
 */
exports.registerToken = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    // ✅ FIX: Reads the 'token' field sent by the Flutter app's api_service.
    const { token } = req.body || {};
    
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