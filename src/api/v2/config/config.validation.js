// File: src/api/v1/config/config.validation.js
const Joi = require('joi');

// Schema for individual cylinder settings
const cylinderSettingSchema = Joi.object({
  id: Joi.string().required().messages({ // Assuming 'id' is a unique identifier for the cylinder type
    'any.required': 'Cylinder setting ID is required.',
    'string.empty': 'Cylinder setting ID cannot be empty.',
  }),
  // FIX: Added name, weightKg, isActive based on backend model (if not already present in your actual code)
  name: Joi.string().required(),
  price: Joi.number().min(0).required().messages({ // Price in smallest currency unit
    'any.required': 'Cylinder price is required.',
    'number.base': 'Cylinder price must be a number.',
    'number.min': 'Cylinder price must be non-negative.', // Allows 0
  }),
  weightKg: Joi.number().min(0).required().messages({ // Weight in KG
    'any.required': 'Cylinder weight (kg) is required.',
    'number.base': 'Cylinder weight (kg) must be a number.',
    'number.min': 'Cylinder weight (kg) must be non-negative.', // Allows 0
  }),
  isActive: Joi.boolean().required(),
});

// Schema for fee settings
const feeSettingsSchema = Joi.object({
  vatPercentage: Joi.number().min(0).max(100).required().messages({
    'any.required': 'VAT percentage is required.',
    'number.base': 'VAT percentage must be a number.',
    'number.min': 'VAT percentage cannot be less than 0.',
    'number.max': 'VAT percentage cannot exceed 100.',
  }),
  serviceFeePercentage: Joi.number().min(0).max(100).required().messages({
    'any.required': 'Service fee percentage is required.',
    'number.base': 'Service fee percentage must be a number.',
    'number.min': 'Service fee percentage cannot be less than 0.',
    'number.max': 'Service fee percentage cannot exceed 100.',
  }),
  baseDeliveryFee: Joi.number().min(0).required().messages({ // In smallest currency unit
    'any.required': 'Base delivery fee is required.',
    'number.base': 'Base delivery fee must be a number.',
    'number.min': 'Base delivery fee cannot be less than 0.',
  }),
  expressDeliverySurcharge: Joi.number().min(0).required().messages({ // In smallest currency unit
    'any.required': 'Express delivery surcharge is required.',
    'number.base': 'Express delivery surcharge must be a number.',
    'number.min': 'Express delivery surcharge cannot be less than 0.',
  }),
});

// --- NEW SCHEMA: Routing Settings Validation ---
const routingSettingsSchema = Joi.object({
  maxPickupWindowMinutes: Joi.number().integer().min(0).required().messages({ // Allows 0
    'any.required': 'Max pickup window minutes is required.',
    'number.base': 'Max pickup window minutes must be an integer.',
    'number.min': 'Max pickup window minutes cannot be negative.',
  }),
  maxBatchWeightKg: Joi.number().min(0).required().messages({ // Allows 0
    'any.required': 'Max batch weight in KG is required.',
    'number.base': 'Max batch weight in KG must be a number.',
    'number.min': 'Max batch weight in KG cannot be negative.',
  }),
});

// <<< START MODIFICATION >>>
const referralProgramSettingsSchema = Joi.object({
  isActive: Joi.boolean().required(),
  programDescription: Joi.string().max(500).required(),
  benefitSelf: Joi.string().max(255).required(),
  benefitFriend: Joi.string().max(255).required(),
  // Validation for new fields
  rewardAmountKobo: Joi.number().integer().min(0).required().messages({
    'number.base': 'Reward amount must be a number.',
    'number.integer': 'Reward amount must be an integer (in Kobo).',
    'number.min': 'Reward amount cannot be negative.',
  }),
  minRefereePurchaseAmountKobo: Joi.number().integer().min(0).required().messages({
    'number.base': 'Min purchase amount must be a number.',
    'number.integer': 'Min purchase amount must be an integer (in Kobo).',
    'number.min': 'Min purchase amount cannot be negative.',
  }),
  referrerMinSuccessfulReferrals: Joi.number().integer().min(1).required().messages({
    'number.base': 'Min successful referrals must be an integer.',
    'number.integer': 'Min successful referrals must be an integer.',
    'number.min': 'Min successful referrals must be at least 1.',
  }),
});
// <<< END MODIFICATION >>>

const updateSystemConfigSchema = Joi.object({
  cylinderSettings: Joi.array().items(Joi.object()).optional(),
  feeSettings: Joi.object().optional(),
  routingSettings: Joi.object().optional(),
  referralProgram: referralProgramSettingsSchema.optional(), // Use the updated schema
}).min(1);

const updatePaymentGatewaySchema = Joi.object({
    gateway: Joi.string().valid('stripe', 'paystack', 'monnify').required(),
});

module.exports = {
  updateSystemConfigSchema,
};