// src/api/v1/chat/chat.validation.js
const Joi = require('joi');

const initiateChatSchema = Joi.object({
  orderId: Joi.string().required().messages({ // Assuming chat is often related to an order
    'any.required': 'Order ID is required to initiate chat.',
    'string.empty': 'Order ID cannot be empty.',
  }),
  recipientId: Joi.string().required().messages({ // The ID of the user to chat with
    'any.required': 'Recipient ID is required to initiate chat.',
    'string.empty': 'Recipient ID cannot be empty.',
  }),
  // You might add other optional fields, e.g., initialMessage
  // initialMessage: Joi.string().optional().max(1000),
});

module.exports = {
  initiateChatSchema,
};