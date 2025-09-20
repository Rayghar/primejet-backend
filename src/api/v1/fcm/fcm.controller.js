// controllers/fcm.controller.js
const { addToken, removeToken } = require('../../../services/notification.service');

async function registerToken(req, res) {
  try {
    const userId = req.user?.id;
    const { token } = req.body || {};
    if (!userId || !token) return res.status(400).json({ error: 'Missing token.' });
    await addToken(userId, token);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to register token.' });
  }
}

async function unregisterToken(req, res) {
  try {
    const userId = req.user?.id;
    const { token } = req.body || {};
    if (!userId || !token) return res.status(400).json({ error: 'Missing token.' });
    await removeToken(userId, token);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to unregister token.' });
  }
}

module.exports = {
  registerToken,
  unregisterToken,
};
