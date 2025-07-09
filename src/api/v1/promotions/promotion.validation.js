// src/api/v1/promotions/promotion.validation.js
const Joi = require('joi');

const promotionSchemaBase = {
  title: Joi.string().min(3).max(100),
  shortDescription: Joi.string().min(10).max(255),
  longDescription: Joi.string().max(1000).optional().allow(null, ''), // Added longDescription to base schema and allowed null/empty string
  promoCode: Joi.string().trim().alphanum().uppercase().min(3).max(20).allow(''), // Allow empty string for promoCode
  isActive: Joi.boolean(),
  validFrom: Joi.date().iso(),
  validUntil: Joi.date().iso().greater(Joi.ref('validFrom')).messages({ // Ensures validUntil is after validFrom
    'date.greater': '"validUntil" must be after "validFrom".'
  }),
  type: Joi.string().valid('Percentage Discount', 'Fixed Amount', 'Free Delivery', 'Item Discount'), // Added 'Free Delivery' and 'Item Discount' to enum
  value: Joi.number().when('type', { // Value validation depends on type
    is: 'Percentage Discount',
    then: Joi.number().min(0).max(100).messages({ // Percentage between 0 and 100 (allowing 0% discount)
        'number.min': 'Percentage discount value must be non-negative.',
        'number.max': 'Percentage discount value cannot exceed 100.',
    }),
    is: 'Free Delivery',
    then: Joi.number().valid(0).messages({ // Free Delivery must have value 0
        'any.only': 'Free Delivery promotion must have a value of 0.',
    }),
    otherwise: Joi.number().min(0).messages({ // Fixed amount must be at least 0 (or your smallest currency unit)
        'number.min': 'Fixed amount value must be non-negative.',
    }),
  }),
  maxUses: Joi.number().integer().min(1).optional(), // Existing optional field
  usesPerUser: Joi.number().integer().min(1).optional().default(1), // Existing optional field with default
  minOrderAmount: Joi.number().min(0).optional(), // Existing optional field
  minOrderWeightKg: Joi.number().min(0).optional().allow(null), // New field: Optional minimum total weight of cylinders
  termsAndConditions: Joi.string().max(1000).optional().allow(null, ''), // Added termsAndConditions to base schema and allowed null/empty string
  imageUrl: Joi.string().uri().max(500).optional().allow(null, ''), // Added imageUrl to base schema and allowed null/empty string
};

const createPromotionSchema = Joi.object({
  ...promotionSchemaBase,
  title: promotionSchemaBase.title.required(),
  shortDescription: promotionSchemaBase.shortDescription.required(),
  promoCode: promotionSchemaBase.promoCode.required(), // Promo code is required for creation, but can be empty string due to .allow('')
  isActive: promotionSchemaBase.isActive.default(true), // Default to active on creation
  validFrom: promotionSchemaBase.validFrom.required(),
  validUntil: promotionSchemaBase.validUntil.required(),
  type: promotionSchemaBase.type.required(),
  value: promotionSchemaBase.value.required(),
}).messages({
  'object.min': 'At least one field must be provided for creation.' // This message should probably be removed for creation schema, as all required fields ensure it's not empty
});


const updatePromotionSchema = Joi.object({
  ...promotionSchemaBase,
  // All fields are optional for update, but at least one must be present
}).min(1).messages({
    'object.min': 'At least one field must be provided for update.'
});

// Schema for route parameters like promoId (optional)
const promoIdParamSchema = Joi.object({
  promoId: Joi.string().required().messages({ // Or Joi.string().uuid() if IDs are UUIDs
    'any.required': 'Promotion ID parameter is required.',
  }),
});

module.exports = {
  createPromotionSchema,
  updatePromotionSchema,
  promoIdParamSchema,
};