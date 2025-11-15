// services/token.service.js
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const dayjs = require('dayjs');
const RefreshToken = require('../models/refreshToken.model');
const User = require('../models/user.model');

// === ENV ===
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;      // REQUIRED
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;    // REQUIRED
const ACCESS_TTL = parseInt(process.env.ACCESS_TOKEN_TTL || '900', 10); // 15m default (seconds)
const REFRESH_TTL_DAYS = parseInt(process.env.REFRESH_TOKEN_TTL_DAYS || '30', 10); // 30 days default

if (!ACCESS_SECRET || !REFRESH_SECRET) {
  // Fail fast in dev; in prod make sure they’re set
  // eslint-disable-next-line no-console
  console.warn('[token.service] Missing JWT secrets. Set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET');
}

// === ACCESS ===
function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role || 'user' },
    ACCESS_SECRET,
    { expiresIn: ACCESS_TTL }
  );
}

// === REFRESH issue (persist hashed copy server-side) ===
async function issueRefreshToken(user, { deviceId, userAgent, ip } = {}) {
  const jti = crypto.randomUUID();
  const expiresAt = dayjs().add(REFRESH_TTL_DAYS, 'day').toDate();

  const refreshJwt = jwt.sign(
    { sub: user.id, jti, did: deviceId || null },
    REFRESH_SECRET,
    { expiresIn: `${REFRESH_TTL_DAYS}d` }
  );

  const tokenHash = await bcrypt.hash(refreshJwt, 12);

  await RefreshToken.create({
    user: user.id,
    tokenHash,
    deviceId: deviceId || null,
    userAgent,
    ip,
    expiresAt,
  });

  return refreshJwt;
}

// === REFRESH verify & rotate ===
async function verifyAndRotateRefreshToken(refreshJwt, { deviceId, userAgent, ip } = {}) {
  let payload;
  try {
    payload = jwt.verify(refreshJwt, REFRESH_SECRET);
  } catch {
    const err = new Error('Invalid refresh token');
    err.status = 401;
    throw err;
  }

  const { sub: userId } = payload;

  // Find a matching stored hash
  const candidates = await RefreshToken.find({ user: userId, revokedAt: { $exists: false } }).lean();
  let matched = null;
  for (const row of candidates) {
    // Compare supplied JWT to stored hash
    // eslint-disable-next-line no-await-in-loop
    const ok = await bcrypt.compare(refreshJwt, row.tokenHash);
    if (ok) { matched = row; break; }
  }

  if (!matched) {
    const err = new Error('Refresh token not found or already rotated');
    err.status = 401;
    throw err;
  }

  // Optional device binding
  if (matched.deviceId && deviceId && matched.deviceId !== deviceId) {
    const err = new Error('Device mismatch');
    err.status = 401;
    throw err;
  }

  // Revoke old, issue new
  await RefreshToken.updateOne({ _id: matched._id }, { $set: { revokedAt: new Date(), replacedBy: 'rotated' } });

  const user = await User.findById(userId);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  const newRefresh = await issueRefreshToken(user, { deviceId, userAgent, ip });
  const newAccess = signAccessToken(user);

  return { accessToken: newAccess, refreshToken: newRefresh, user };
}

// === Revoke ===
async function revokeRefreshToken(refreshJwt) {
  const active = await RefreshToken.find({ revokedAt: { $exists: false } });
  for (const row of active) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await bcrypt.compare(refreshJwt, row.tokenHash);
    if (ok) {
      await RefreshToken.updateOne({ _id: row._id }, { $set: { revokedAt: new Date() } });
      return true;
    }
  }
  return false;
}

module.exports = {
  signAccessToken,
  issueRefreshToken,
  verifyAndRotateRefreshToken,
  revokeRefreshToken,
};
