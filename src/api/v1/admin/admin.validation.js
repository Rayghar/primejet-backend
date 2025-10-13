const Joi = require('joi');

const sendNotificationSchema = {
  body: Joi.object({
    title: Joi.string().min(5).max(100).required(),
    body: Joi.string().min(10).max(500).required(),
    targetType: Joi.string().valid(
      'allCustomers', 
      'allDrivers', 
      'allUsers', 
      'singleUser', 
      'byZone'
    ).required(),
    targetUserId: Joi.string().uuid().when('targetType', {
      is: 'singleUser',
      then: Joi.required(),
      otherwise: Joi.optional().allow(null, ''),
    }),
    targetZoneId: Joi.string().when('targetType', { // Assuming zone IDs are strings or UUIDs
      is: 'byZone',
      then: Joi.required(),
      otherwise: Joi.optional().allow(null, ''),
    }),
  }),
};

module.exports = {
  sendNotificationSchema,
};