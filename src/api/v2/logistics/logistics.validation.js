// src/api/v2/logistics/logistics.validation.js
const Joi = require('joi');

// Schema for assigning an order to a driver/van
const assignOrderToVanSchema = Joi.object({
  orderId: Joi.string().required().messages({
    'any.required': 'Order ID is required.',
    'string.empty': 'Order ID cannot be empty.',
  }),
  driverId: Joi.string().required().messages({ // Assuming driverId is equivalent to vanId in frontend context
    'any.required': 'Driver ID (Van ID) is required.',
    'string.empty': 'Driver ID (Van ID) cannot be empty.',
  }),
  // You might include additional order details if they are passed in the body
  // e.g., orderDetails: Joi.object().optional(),
});

module.exports = {
  assignOrderToVanSchema,
};