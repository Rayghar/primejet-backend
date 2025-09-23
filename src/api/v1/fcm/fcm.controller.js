// controllers/fcm.controller.js
// Minimal controller that stores/removes a device token for the authenticated user

const {
  addToken,
  removeToken,
} = require('../../../api/v1/fcm/fcm.service'); // adjust path if your services live elsewhere

exports.registerToken = async (req, res, next) => {
  try {
    const userId = req.user && req.user.id;
    const { token } = req.body || {};
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (!token) return res.status(400).json({ error: 'token required' });

    await addToken(userId, token);
    return res.json({ ok: true });
  } catch (e) {
    return next(e);
  }
};

exports.unregisterToken = async (req, res, next) => {
  try {
    const userId = req.user && req.user.id;
    const { token } = req.body || {};
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (!token) return res.status(400).json({ error: 'token required' });

    await removeToken(userId, token);
    return res.json({ ok: true });
  } catch (e) {
    return next(e);
  }
};
