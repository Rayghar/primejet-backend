const Joi = require('joi');

// <<-- NEW: Define a reusable schema for a price override object -->>
const priceOverrideSchema = Joi.object({
  cylinderId: Joi.string().required(),
  newPrice: Joi.number().integer().min(0).required()
});

const createZoneSchema = Joi.object({
  name: Joi.string().trim().required(),
  state: Joi.string().trim().required(),
  isActive: Joi.boolean().optional(),
  outOfZoneMessage: Joi.string().required(),
  deliveryFee: Joi.number().integer().min(0).required(),
  expressSurcharge: Joi.number().integer().min(0).required(),
  area: Joi.object({
    type: Joi.string().valid('Polygon').required(),
    coordinates: Joi.array().items(
      Joi.array().items(
        Joi.array().items(Joi.number()).length(2)
      )
    ).required()
  }).required(),
  // <<-- MODIFIED: Add priceOverrides to the schema -->>
  priceOverrides: Joi.array().items(priceOverrideSchema).optional()
});

const updateZoneSchema = Joi.object({
  name: Joi.string().trim().optional(),
  state: Joi.string().trim().optional(),
  isActive: Joi.boolean().optional(),
  outOfZoneMessage: Joi.string().optional(),
  deliveryFee: Joi.number().integer().min(0).optional(),
  expressSurcharge: Joi.number().integer().min(0).optional(),
  // <<-- MODIFIED: Add priceOverrides to the schema -->>
  priceOverrides: Joi.array().items(priceOverrideSchema).optional()
});

module.exports = {
  createZoneSchema,
  updateZoneSchema,
};