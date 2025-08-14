// src/api/v1/referrals/referral.controller.js
const referralService = require('./referral.service'); // Path to co-located service
const HttpError = require('../../../utils/HttpError'); // Path to global HttpError utility
// const { logger } = require('../../../config/logger.config.js'); // Optional: for structured logging

const getReferral = async (req, res, next) => {
  try {
    // req.user.id is populated by authMiddleware and is the customer's ID
    const referralDetails = await referralService.getReferralInformation(req.user.id);

    if (!referralDetails) {
      // If service returns null/undefined, and that's a valid state (e.g., user has no referral code yet),
      // then sending an empty object or a specific message might be appropriate.
      // For now, assume the service ensures a referral record exists or throws an error.
      return res.status(200).json(referralDetails);
    }

    res.status(200).json(referralDetails);
  } catch (error) {
    // logger.error(`[REFERRAL_CONTROLLER] Error in getReferral for user ${req.user.id}:`, error);
    next(error);
  }
};

const getReferralsAdmin = async (req, res, next) => { // New controller for admin to get all referrals
  try {
    const { page = 1, limit = 10, search = '' } = req.query;
    const result = await referralService.getReferralsForAdmin({
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      search,
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};


// Example for future expansion: Controller to handle applying a referral code
// const applyReferralCode = async (req, res, next) => {
//   try {
//     const { referralCode } = req.body; // Validated by Joi
//     const refereeUserId = req.user.id; // The user applying the code
//     const result = await referralService.applyReferralCode(refereeUserId, referralCode);
//     res.status(200).json(result);
//   } catch (error) {
//     next(error);
//   }
// };

module.exports = {
  getReferral,
  getReferralsAdmin, // Export the new admin controller
  // applyReferralCode, // Uncomment and implement if needed
};