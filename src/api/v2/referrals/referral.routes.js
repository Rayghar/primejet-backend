// src/api/v1/referrals/referral.routes.js
const express = require('express');
const referralController = require('./referral.controller'); // Path to co-located controller
const authMiddleware = require('../../../middleware/auth.middleware'); // Path to global auth middleware
const validate = require('../../../middleware/validate.middleware'); // Path to global validate middleware
const { getReferralsAdminQuerySchema } = require('./referral.validation'); // Path to co-located validation

const router = express.Router();

console.log('[REFERRAL_ROUTES] Registering referral routes...');

// Public route to get active promotions // <<< REMOVE THIS ENTIRE BLOCK
// router.get(
//   '/active', // This route typically sits under /promotions
//   // Re-confirming if this /referrals/active route is intended,
//   // or if it was a copy-paste from promotions.
//   // Assuming it's not needed for referrals in this context for now.
//   // If it is, it would return global referral program details.
// ); // Missing handler here.


// Customer route to get their own referral information
router.get(
  '/',
  authMiddleware('customer'), // Only authenticated customers can access their referral info
  referralController.getReferral
);

// Admin routes for managing referrals (view all referrals)
router.get(
  '/admin', // Admin endpoint to get all referral records
  authMiddleware('admin'),
  validate(getReferralsAdminQuerySchema, 'query'), // Validate query parameters for admin list
  referralController.getReferralsAdmin
);

// Example for future expansion: Apply a referral code
// router.post(
//   '/apply',
//   authMiddleware('customer'), // Or during registration before auth
//   validate(applyReferralCodeSchema), // Assuming applyReferralCodeSchema is defined in referral.validation.js
//   referralController.applyReferralCode
// );

console.log('[REFERRAL_ROUTES] Referral routes registered.');

module.exports = router;