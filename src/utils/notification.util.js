// This module uses dynamic import to work in a CommonJS environment.

let fetch;

// The function to be exported. It's an async IIFE (Immediately Invoked Function Expression)
// that dynamically imports 'node-fetch' and assigns it to the 'fetch' variable.
const sendNotificationToUser = async (fcmUrl, secretKey, userId, title, body, data) => {
  if (!fetch) {
    try {
      const nodeFetchModule = await import('node-fetch');
      fetch = nodeFetchModule.default;
    } catch (e) {
      console.error('Failed to load node-fetch module:', e);
      return;
    }
  }

  try {
    const response = await fetch(fcmUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${secretKey}`,
      },
      body: JSON.stringify({ userId, title, body, data })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Failed to send push notification. Status: ${response.status}. Error: ${errorText}`);
    } else {
      console.log(`Push notification request sent for user ${userId}.`);
    }
  } catch (error) {
    console.error(`Failed to send push notification for user ${userId}:`, error);
  }
};

module.exports = {
  sendNotificationToUser,
};