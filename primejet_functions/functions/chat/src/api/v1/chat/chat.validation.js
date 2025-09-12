const Joi = require('joi');

const initiateChatSchema = Joi.object({
  orderId: Joi.string().required().messages({
    'any.required': 'Order ID is required to initiate chat.',
    'string.empty': 'Order ID cannot be empty.',
  }),
  recipientId: Joi.string().required().messages({
    'any.required': 'Recipient ID is required to initiate chat.',
    'string.empty': 'Recipient ID cannot be empty.',
  }),
});

module.exports = {
  initiateChatSchema,
};