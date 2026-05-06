// src/api/configService.js
import httpClient from './httpClient';

/**
 * Fetches the global application configuration settings.
 * @returns {Promise<object>} The configuration object.
 */
const getConfiguration = async () => {
  const { data } = await httpClient.get('/config');
  return data;
};

/**
 * Updates the global application configuration settings.
 * @param {object} settingsData - The new configuration data.
 * @returns {Promise<object>} The updated configuration object.
 */
const updateConfiguration = async (settingsData) => {
  const { data } = await httpClient.put('/config', settingsData);
  return data;
};

export { getConfiguration, updateConfiguration };