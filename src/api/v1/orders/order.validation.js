// src/api/v1/orders/order.validation.js
const Joi = require('joi');

const orderItemSchema = Joi.object({
  cylinderId: Joi.string().required().messages({
    'any.required': 'Cylinder ID is required for each item.',
  }),
  quantity: Joi.number().integer().min(1).required().messages({
    'number.base': 'Item quantity must be a number.',
    'number.integer': 'Item quantity must be an integer.',
    'number.min': 'Item quantity must be at least 1.',
    'any.required': 'Item quantity is required.',
  }),
  unitPrice: Joi.number().positive().required().messages({ // Price might be fetched server-side but good to have if client sends it
    'number.base': 'Unit price must be a number.',
    'number.positive': 'Unit price must be a positive number.',
    'any.required': 'Unit price is required.',
  }),
  productName: Joi.string().required().messages({ // Similar to unitPrice, could be server-derived
    'any.required': 'Product name is required for each item.',
  }),
});

const placeOrderSchema = Joi.object({
  deliveryAddressId: Joi.string().required().messages({
    'any.required': 'Delivery address ID is required.',
  }),
  items: Joi.array().items(orderItemSchema).min(1).required().messages({
    'array.base': 'Items must be an array.',
    'array.min': 'At least one item is required in the order.',
    'any.required': 'Order items are required.',
  }),
  recipientName: Joi.string().min(2).max(100).required().messages({
    'string.min': 'Recipient name must be at least 2 characters.',
    'string.max': 'Recipient name cannot exceed 100 characters.',
    'any.required': 'Recipient name is required.',
  }),
  recipientPhone: Joi.string().pattern(/^\+?\d{10,15}$/).required().messages({
    'string.pattern.base': 'Recipient phone number must be a valid format (e.g., +2348012345678).',
    'any.required': 'Recipient phone number is required.',
  }),
  isExpress: Joi.boolean().optional().default(false),
  useWalletBalance: Joi.boolean().optional().default(false),
  promoCodeApplied: Joi.string().trim().allow('', null).optional(), // Allow empty string or null
  referralCode: Joi.string().trim().allow('', null).optional(), // <<< SURGICAL FIX
  deliveryLatitude: Joi.number().min(-90).max(90).optional(), // Assuming these might be optional at placement
  deliveryLongitude: Joi.number().min(-180).max(180).optional(),
  deliveryAddressSnapshot: Joi.object().optional(), // Can be complex, or just a placeholder if always generated server-side
});

const processOrderPaymentSchema = Joi.object({
  // Fields required by your order.service.processPayment
  amount: Joi.number().positive().required().messages({
      'number.base': 'Payment amount must be a number.',
      'number.positive': 'Payment amount must be positive.',
      'any.required': 'Payment amount is required.',
  }),
  transactionId: Joi.string().required().messages({
      'any.required': 'Payment transaction ID is required.',
  }),
  // Add any other payment-related fields you expect, e.g., paymentMethodId, gatewayReference
});

const submitFeedbackSchema = Joi.object({
  rating: Joi.number().integer().min(1).max(5).required().messages({
    'number.base': 'Rating must be a number.',
    'number.integer': 'Rating must be an integer between 1 and 5.',
    'number.min': 'Rating must be at least 1.',
    'number.max': 'Rating cannot exceed 5.',
    'any.required': 'Rating is required.',
  }),
  comment: Joi.string().min(5).max(1000).required().messages({
    'string.min': 'Feedback comment must be at least 5 characters.',
    'string.max': 'Feedback comment cannot exceed 1000 characters.',
    'any.required': 'Feedback comment is required.',
  }),
});

const orderStatusUpdateSchema = Joi.object({
  status: Joi.string().valid('pending', 'accepted', 'in-progress', 'delivered', 'canceled', 'Order Placed', 'Pending Pickup', 'Driver Assigned', 'Pending Payment').required().messages({ // Expanded with statuses from your service/model
    'any.only': 'Invalid status value.',
    'any.required': 'Status is required.',
  }),
  notes: Joi.string().max(500).allow('', null).optional(),
});

const adminAssignDriverSchema = Joi.object({
  driverId: Joi.string().required().messages({
    'any.required': 'Driver ID is required for assignment.',
  }),
});

// Schema for route parameters like orderId (optional, for consistency)
const orderIdParamSchema = Joi.object({
  orderId: Joi.string().required().messages({ // Consider adding UUID validation if your IDs are UUIDs
    'any.required': 'Order ID parameter is required.',
  }),
});

module.exports = {
  placeOrderSchema,
  processOrderPaymentSchema,
  submitFeedbackSchema,
  orderStatusUpdateSchema,
  adminAssignDriverSchema,
  orderIdParamSchema, // Export if you want to validate params separately in routes
};