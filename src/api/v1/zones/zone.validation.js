const Joi = require('joi');

const createZoneSchema = Joi.object({
  name: Joi.string().trim().required(),
  state: Joi.string().trim().required(),
  isActive: Joi.boolean().optional(),
  outOfZoneMessage: Joi.string().optional(),
  deliveryFee: Joi.number().min(0).required(),
  expressSurcharge: Joi.number().min(0).required(),
  area: Joi.object({
    type: Joi.string().valid('Polygon').required(),
    coordinates: Joi.array().items(
      Joi.array().items(
        Joi.array().items(Joi.number()).length(2) // Array of [lng, lat] points
      )
    ).required()
  }).required()
});

const updateZoneSchema = Joi.object({
  name: Joi.string().trim().optional(),
  state: Joi.string().trim().optional(),
  isActive: Joi.boolean().optional(),
  outOfZoneMessage: Joi.string().optional(),
  deliveryFee: Joi.number().min(0).optional(),
  expressSurcharge: Joi.number().min(0).optional(),
  // Area is typically not updatable via this endpoint, but can be added if needed
});

module.exports = {
  createZoneSchema,
  updateZoneSchema,
};