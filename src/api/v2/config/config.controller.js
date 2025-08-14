// src/api/v2/config/config.controller.js
const Config = require('../../../models/config.model'); // Import the Config model
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');


/**
 * Fetches the current global configuration settings.
 */
const getConfiguration = async (req, res, next) => {
  try {
    // There should typically be only one global config document
    const config = await configService.getConfiguration(); 
    if (!config) {
      // If no config exists, create a default one (or return empty and let frontend handle defaults)
      logger.warn('[CONFIG_CONTROLLER] No global config found, returning default structure.');
      return res.status(200).json({
        systemName: 'PrimeJet Gas Delivery Configuration',
        cylinderSettings: [],
        feeSettings: {
          vatPercentage: 7.5,
          serviceFeePercentage: 2.5,
          baseDeliveryFee: 500,
          expressDeliverySurcharge: 200,
        },
        routingSettings: {
          maxPickupWindowMinutes: 60,
          maxBatchWeightKg: 500,
        },
        referralProgram: {
          isActive: false,
          programDescription: "Share your code with friends! They get a discount, and you get rewards.",
          benefitSelf: "Get N500 off your next order for every successful referral.",
          benefitFriend: "Get 10% off their first order.",
          rewardAmountKobo: 50000,
          minRefereePurchaseAmountKobo: 0,
          referrerMinSuccessfulReferrals: 1,
        },
      });
    }
    res.status(200).json(config);
  } catch (error) {
    logger.error('Error fetching configuration:', error);
    next(new HttpError(500, 'Failed to fetch configuration.'));
  }
};

/**
 * Updates the global configuration settings.
 * This will typically update the single config document.
 */
const updateConfiguration = async (req, res, next) => {
  try {
    const updateData = req.body;

    // Find and update the single config document. Use upsert: true to create if it doesn't exist.
    const updatedConfig = await Config.findOneAndUpdate(
      {}, // Query to find any document (assuming only one)
      { $set: updateData },
      { new: true, upsert: true, runValidators: true } // Return updated doc, create if not exists, run schema validators
    );

    logger.info('Global configuration updated successfully.');
    res.status(200).json({ message: 'Configuration updated successfully.', config: updatedConfig });
  } catch (error) {
    logger.error('Error updating configuration:', error);
    // Handle validation errors specifically if needed
    if (error.name === 'ValidationError') {
      return next(new HttpError(400, error.message));
    }
    next(new HttpError(500, 'Failed to update configuration.'));
  }
};

module.exports = {
  getConfiguration,
  updateConfiguration,
};