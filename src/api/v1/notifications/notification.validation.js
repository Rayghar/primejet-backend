// File: src/api/v1/notifications/notification.validation.js
const Joi = require('joi');

const sendNotificationSchema = Joi.object({
  title: Joi.string().min(5).max(100).required().messages({ // Match frontend validation length
    'any.required': 'Notification title is required.',
    'string.empty': 'Notification title cannot be empty.',
    'string.min': 'Notification title must be at least 5 characters long.',
    'string.max': 'Notification title cannot exceed 100 characters.',
  }),
  body: Joi.string().min(10).max(1000).required().messages({ // Match frontend validation length
    'any.required': 'Notification body is required.',
    'string.empty': 'Notification body cannot be empty.',
    'string.min': 'Notification body must be at least 10 characters long.',
    'string.max': 'Notification body cannot exceed 1000 characters.',
  }),
  targetType: Joi.string().valid('allUsers', 'allCustomers', 'allDrivers', 'singleUser').required().messages({ // Correct enum values
    'any.required': 'Notification target type is required.',
    'any.only': 'Invalid target type specified.',
  }),
  targetUserId: Joi.string().when('targetType', { // targetUserId is required only if targetType is 'singleUser'
    is: 'singleUser',
    then: Joi.string().uuid().required().messages({ // Assuming user IDs are UUIDs
        'any.required': 'User ID is required for single user notification.',
        'string.guid': 'User ID must be a valid UUID.',
    }),
    otherwise: Joi.forbidden(), // Not allowed for other target types
  }),
  // Add optional 'data' field if you want to send custom payload for deep linking
  data: Joi.object().optional(),
});

module.exports = {
  sendNotificationSchema,
};