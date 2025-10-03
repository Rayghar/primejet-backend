// File: src/api/v1/notifications/notification.validation.js

const Joi = require('joi');

const notificationIdParamSchema = Joi.object({
  notificationId: Joi.string().uuid().required().messages({
    'string.guid': 'Notification ID must be a valid UUID.',
    'any.required': 'Notification ID parameter is required.',
  }),
});

module.exports = {
  notificationIdParamSchema,
};