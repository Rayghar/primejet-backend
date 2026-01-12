// File: src/api/v1/orders/order.validation.js
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
  unitPrice: Joi.number().positive().required().messages({ 
    'number.base': 'Unit price must be a number.',
    'number.positive': 'Unit price must be a positive number.',
    'any.required': 'Unit price is required.',
  }),
  productName: Joi.string().required().messages({ 
    'any.required': 'Product name is required for each item.',
  }),
});

const placeOrderSchema = Joi.object({
  deliveryAddressId: Joi.string().required().messages({
    'any.required': 'Delivery address ID is required.',
  }),
  items: Joi.array().items(orderItemSchema).min(1).required().messages({
    'array.base': 'Items must be an array.',
    'array.min': 'At least one item is required.',
    'any.required': 'Items are required.',
  }),
  recipientName: Joi.string().optional(),
  recipientPhone: Joi.string().optional(),
  isExpress: Joi.boolean().optional(),
  useWalletBalance: Joi.boolean().optional(),
  promoCodeApplied: Joi.string().allow('', null).optional(),
  paymentMethod: Joi.string().valid('card', 'wallet', 'stripe', 'paystack', 'payOnPickup').optional(),
});

const processOrderPaymentSchema = Joi.object({
  amount: Joi.number().positive().required().messages({
    'number.base': 'Amount must be a number.',
    'number.positive': 'Amount must be positive.',
    'any.required': 'Amount is required.',
  }),
  transactionId: Joi.string().required().messages({
    'any.required': 'Transaction ID is required.',
  }),
  gateway: Joi.string().optional(),
});

const submitFeedbackSchema = Joi.object({
  rating: Joi.number().min(1).max(5).required().messages({
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
  status: Joi.string().valid(
    // Original Statuses
    'pending', 'accepted', 'in-progress', 'delivered', 'canceled', 
    'Order Placed', 'Pending Pickup', 'Driver Assigned', 'Pending Payment', 
    'Awaiting Driver Arrival', 'Out for Delivery', 'Customer Unavailable', 'Failed',
    // ✅ NEW STATUSES FOR POWER & V2 FLOWS
    'Vending Failed', 'Payment Discrepancy', 'Completed', 'Processing'
  ).required().messages({
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

const orderIdParamSchema = Joi.object({
  orderId: Joi.string().required().messages({
    'any.required': 'Order ID parameter is required.',
  }),
});

module.exports = {
  orderItemSchema,
  placeOrderSchema,
  processOrderPaymentSchema,
  submitFeedbackSchema,
  orderStatusUpdateSchema,
  adminAssignDriverSchema,
  orderIdParamSchema,
};