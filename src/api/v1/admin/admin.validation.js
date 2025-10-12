// src/api/v1/admin/admin.validation.js
const Joi = require('joi');

const sendNotificationSchema = {
  body: Joi.object({
    title: Joi.string().min(3).max(100).required(),
    body: Joi.string().min(5).max(500).required(),
    // Enforce the allowed target types
    targetType: Joi.string().valid('allCustomers', 'allDrivers', 'allUsers', 'singleUser', 'byZone').required(),
    
    // `targetUserId` is required only when `targetType` is 'singleUser'
    targetUserId: Joi.string().when('targetType', {
      is: 'singleUser',
      then: Joi.string().uuid({ version: 'uuidv4' }).required(),
      otherwise: Joi.optional(),
    }),
    
    // `targetZoneId` is required only when `targetType` is 'byZone'
    targetZoneId: Joi.string().when('targetType', {
      is: 'byZone',
      then: Joi.string().required(), // Assuming zone IDs are strings (like UUIDs or slugs)
      otherwise: Joi.optional(),
    }),

    // Optional data payload for deep-linking in the app
    data: Joi.object().optional(),
  }),
};

module.exports = {
  sendNotificationSchema,
};