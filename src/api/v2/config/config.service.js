// src/services/configService.js
const Config = require('../models/config.model');
const HttpError = require('../utils/HttpError');
const { logger } = require('../config/logger.config');

// Fetches general system settings from the database (fees, etc.)
const getConfiguration = async () => {
  try {
    const config = await Config.findOne().lean(); // Use .lean() for faster, plain JavaScript objects
    return config;
  } catch (error) {
    logger.error('Error retrieving system configuration:', error);
    throw new HttpError(500, 'Failed to retrieve system configuration.');
  }
};

// Updates general system settings in the database.
const updateConfiguration = async (configData) => {
  try {
    const updatedConfig = await Config.findOneAndUpdate(
      {},
      { $set: configData },
      { new: true, upsert: true, runValidators: true }
    ).lean();
    return updatedConfig;
  } catch (error) {
    logger.error(`Failed to update system configuration: ${error.message}`, error);
    throw new HttpError(500, `Failed to update system configuration: ${error.message}`);
  }
};

// Note: I've removed the updateActiveGateway function as it's not called by the controller and might be a legacy v1 function.
// If you need it, you can add it back and ensure your controller or a new route calls it.

module.exports = {
  getConfiguration,
  updateConfiguration,
}; 