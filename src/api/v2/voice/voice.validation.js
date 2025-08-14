// File: src/api/v1/voice/voice.validation.js
const Joi = require('joi');

const generateTokenSchema = Joi.object({
  channelName: Joi.string().trim().required().messages({
    'any.required': 'A channelName is required to generate a call token.',
    'string.empty': 'channelName cannot be empty.',
  }),
});

module.exports = {
  generateTokenSchema,
};