const Joi = require('joi');

const createZoneSchema = Joi.object({
  name: Joi.string().trim().required(),
  state: Joi.string().trim().required(),
  isActive: Joi.boolean().optional(),
  outOfZoneMessage: Joi.string().required(),
  // <<-- NEW: Make pricing fields required on creation -->>
  deliveryFee: Joi.number().integer().min(0).required(),
  expressSurcharge: Joi.number().integer().min(0).required(),
  area: Joi.object({
    type: Joi.string().valid('Polygon').required(),
    coordinates: Joi.array().items(
      Joi.array().items(
        Joi.array().items(Joi.number()).length(2)
      )
    ).required()
  }).required()
});

const updateZoneSchema = Joi.object({
  name: Joi.string().trim().optional(),
  state: Joi.string().trim().optional(),
  isActive: Joi.boolean().optional(),
  outOfZoneMessage: Joi.string().optional(),
  // <<-- NEW: Make pricing fields optional on update -->>
  deliveryFee: Joi.number().integer().min(0).optional(),
  expressSurcharge: Joi.number().integer().min(0).optional(),
});

module.exports = {
  createZoneSchema,
  updateZoneSchema,
};