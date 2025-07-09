// File: src/api/v1/config/config.service.js
const Config = require('../../../models/config.model');
const HttpError = require('../../../utils/HttpError');
const { setActiveGateway } = require('../../../config');

// Fetches general system settings from the database (fees, etc.)
const getSystemConfig = async () => {
  try {
    const config = await Config.findOne();
    if (!config) {
      throw new HttpError(404, 'System configuration not found. Please set it up via the admin panel.');
    }
    return config.toObject();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(500, 'Failed to retrieve system configuration.');
  }
};

// Updates general system settings in the database.
const updateSystemConfig = async (configData) => {
  try {
    const updatedConfig = await Config.findOneAndUpdate(
      {},
      { $set: configData },
      { new: true, upsert: true, runValidators: true }
    );
    return updatedConfig.toObject();
  } catch (error) {
    throw new HttpError(500, `Failed to update system configuration: ${error.message}`);
  }
};

// Updates the active payment gateway in the application's runtime config.
const updateActiveGateway = (gateway) => {
    if (!gateway) {
        throw new HttpError(400, 'Gateway name is required.');
    }
    const success = setActiveGateway(gateway);
    if (!success) {
        throw new HttpError(400, 'Invalid or unsupported gateway specified.');
    }
    return { message: `Active payment gateway successfully set to ${gateway}.` };
};

module.exports = {
  getSystemConfig,
  updateSystemConfig,
  updateActiveGateway,
};