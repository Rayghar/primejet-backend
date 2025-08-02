// File: src/api/v1/agents/agent.validation.js
const Joi = require('joi');

const agentSchemaBase = {
  name: Joi.string().trim().min(3).max(100),
  email: Joi.string().email().trim().lowercase().optional().allow(null, ''),
  phone: Joi.string().trim().pattern(/^\+?\d{10,15}$/).messages({
    'string.pattern.base': 'Phone number must be a valid format (e.g., +23480...).',
  }),
  agentCode: Joi.string().trim().uppercase().min(4).max(12).alphanum(),
  isActive: Joi.boolean(),
  // ============================= NEW FIELD =============================
  password: Joi.string().min(6),
  // =====================================================================
};

const createAgentSchema = Joi.object({
  name: agentSchemaBase.name.required(),
  email: agentSchemaBase.email.optional(),
  phone: agentSchemaBase.phone.required(),
  // ============================= MODIFIED =============================
  // Password is now required when creating an agent.
  password: agentSchemaBase.password.required(),
  // ====================================================================
  agentCode: agentSchemaBase.agentCode.optional().allow('', null), // Make optional to allow auto-generation
  isActive: agentSchemaBase.isActive.default(true),
});

const updateAgentSchema = Joi.object({
  name: agentSchemaBase.name.optional(),
  email: agentSchemaBase.email.optional(),
  phone: agentSchemaBase.phone.optional(),
  agentCode: agentSchemaBase.agentCode.optional(),
  isActive: agentSchemaBase.isActive.optional(),
  // ============================= NEW FIELD =============================
  // Allow password to be updated.
  password: agentSchemaBase.password.optional(),
  // =====================================================================
}).min(1).messages({
  'object.min': 'At least one field must be provided for update.',
});

// ============================= NEW SCHEMA =============================
// Schema for the new agent login route.
const agentLoginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});
// ====================================================================

const getAgentsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  search: Joi.string().trim().max(100).optional().allow(''),
  isActive: Joi.boolean().optional(),
});

module.exports = {
  createAgentSchema,
  updateAgentSchema,
  getAgentsQuerySchema,
  agentLoginSchema, // Export the new schema
};
