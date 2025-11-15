// models/refreshToken.model.js
const mongoose = require('mongoose');

const refreshTokenSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
    tokenHash: { type: String, required: true, unique: true },
    deviceId: { type: String, index: true },   // optional binding to device
    userAgent: { type: String },
    ip: { type: String },
    expiresAt: { type: Date, index: true, required: true },
    revokedAt: { type: Date },
    replacedBy: { type: String },              // marker for rotation chains
  },
  { timestamps: true }
);

module.exports = mongoose.model('RefreshToken', refreshTokenSchema);
