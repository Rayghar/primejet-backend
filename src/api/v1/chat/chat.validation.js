// src/api/v1/chat/chat.validation.js
const Joi = require('joi');

const initiateChatSchema = Joi.object({
  orderId: Joi.string().required().messages({
    'any.required': 'Order ID is required to initiate chat.',
    'string.empty': 'Order ID cannot be empty.',
  }),
  // <<< ADD THIS SECTION >>>
  senderId: Joi.string().required().messages({
    'any.required': 'Sender ID is required to initiate chat.',
    'string.empty': 'Sender ID cannot be empty.',
  }),
  // <<< END OF ADDITION >>>
  recipientId: Joi.string().required().messages({
    'any.required': 'Recipient ID is required to initiate chat.',
    'string.empty': 'Recipient ID cannot be empty.',
  }),
});

module.exports = {
  initiateChatSchema,
};