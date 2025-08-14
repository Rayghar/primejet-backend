// File: src/api/v1/voice/voice.service.js
const { RtcTokenBuilder, RtcRole } = require('agora-access-token');

const APP_ID = process.env.AGORA_APP_ID;
const APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE;

if (!APP_ID || !APP_CERTIFICATE) {
  // It's critical to have these environment variables set.
  // Throwing an error here prevents the service from starting without them.
  console.error('ERROR: Agora App ID and Certificate must be set in environment variables.');
  // In a production app, you might want a more graceful startup or a health check.
  process.exit(1); // Exit process if critical env vars are missing
}

/**
 * Generates an RTC token for a user to join a channel.
 * @param {string} channelName - The name of the channel to join.
 * @param {string} userId - The user ID from your database (used as Agora UID).
 * @returns {string} The generated Agora RTC token.
 */
const generateAgoraRtcToken = (channelName, userId) => {
  // Agora recommends using integer UIDs. If your userId is a UUID,
  // you might need a mapping strategy (e.g., hash to integer, or a database lookup).
  // For simplicity, we can use 0 for the token's UID, and the client will use their own UID.
  // Alternatively, you could try to hash your UUID to an int.
  const agoraUid = 0; // Use 0 for token generation if client uses their own UID to join
                      // or if you map your UUIDs to integers and want to pass it here.
                      // For Agora UI Kit, passing 0 here and letting UI Kit handle client's UID is common.
  const role = RtcRole.PUBLISHER; // PUBLISHER role is generally needed for both speaking and hearing.
  const expirationTimeInSeconds = 3600; // Token expiration time (1 hour)
  const currentTimestamp = Math.floor(Date.now() / 1000);
  const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

  console.log(`[AGORA_SERVICE] Generating token for channel: "${channelName}" (UID for token: ${agoraUid})`);

  const token = RtcTokenBuilder.buildTokenWithUid(
    APP_ID,
    APP_CERTIFICATE,
    channelName,
    agoraUid, // The UID associated with this token (can be 0 or specific user's Agora UID)
    role,
    privilegeExpiredTs
  );

  return token;
};

module.exports = {
  generateAgoraRtcToken,
};