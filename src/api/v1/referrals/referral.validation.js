// src/api/v1/referrals/referral.validation.js
const Joi = require('joi');

// ### SURGICAL FIX: ADDED MISSING SCHEMA ###
const getReferralsAdminQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).optional().default(1),
  limit: Joi.number().integer().min(1).max(100).optional().default(15),
  search: Joi.string().trim().allow('', null).optional(),
});


// Example for future expansion: Apply a referral code
// const applyReferralCodeSchema = Joi.object({
//   referralCode: Joi.string().trim().alphanum().uppercase().required().messages({
//     'any.required': 'Referral code is required.',
//     'string.empty': 'Referral code cannot be empty.',
//   }),
// });

module.exports = {
  getReferralsAdminQuerySchema, // <<< EXPORT THE NEW SCHEMA
  // applyReferralCodeSchema,
};