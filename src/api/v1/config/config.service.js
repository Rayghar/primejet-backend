// File: src/api/v1/config/config.service.js
// << UPDATED FILE >>

const Config = require('../../../models/config.model');
const ServiceZone = require('../../../models/serviceZone.model'); // << NEW: Import ServiceZone model
const HttpError = require('../../../utils/HttpError');
const { setActiveGateway } = require('../../../config');
const { logger } = require('../../../config/logger.config');

// Fetches general system settings and active service zones from the database.
const getSystemConfig = async () => {
  try {
    const config = await Config.findOne().lean(); // Use .lean() for a plain JS object
    if (!config) {
      throw new HttpError(404, 'System configuration not found. Please set it up via the admin panel.');
    }

    // << FIX: Fetch all active service zones from the database >>
    const serviceZones = await ServiceZone.find({ isActive: true }).lean();

    // << FIX: Combine the base config with the active zones into a single response object >>
    const fullConfig = {
      ...config,
      serviceZones: serviceZones, // Add the zones to the response
    };

    return fullConfig;

  } catch (error) {
    logger.error(`[CONFIG_SERVICE] Error fetching system config: ${error.message}`);
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
    return { message: `Payment gateway successfully set to ${gateway}.`, gateway };
};


module.exports = {
  getSystemConfig,
  updateSystemConfig,
  updateActiveGateway,
};