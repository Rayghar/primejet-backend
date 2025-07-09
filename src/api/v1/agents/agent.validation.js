// File: src/api/v1/agents/agent.validation.js
const Joi = require('joi');

const agentSchemaBase = {
  name: Joi.string().trim().min(3).max(100),
  email: Joi.string().email().trim().lowercase().optional().allow(null, ''),
  phone: Joi.string().trim().pattern(/^\+?\d{10,15}$/).messages({
    'string.pattern.base': 'Phone number must be a valid format (e.g., +23480...).',
  }),
  agentCode: Joi.string().trim().uppercase().min(4).max(12).alphanum(), // Alphanumeric for codes
  isActive: Joi.boolean(),
};

const createAgentSchema = Joi.object({
  name: agentSchemaBase.name.required(),
  email: agentSchemaBase.email.optional(), // Email can be optional if phone is primary
  phone: agentSchemaBase.phone.required(),
  agentCode: agentSchemaBase.agentCode.required(),
  isActive: agentSchemaBase.isActive.default(true),
});

const updateAgentSchema = Joi.object({
  name: agentSchemaBase.name.optional(),
  email: agentSchemaBase.email.optional(),
  phone: agentSchemaBase.phone.optional(),
  agentCode: agentSchemaBase.agentCode.optional(), // Can update code, but uniqueness is checked in service
  isActive: agentSchemaBase.isActive.optional(),
}).min(1).messages({
  'object.min': 'At least one field must be provided for update.',
});

const getAgentsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  search: Joi.string().trim().max(100).optional().allow(''), // Search by name, email, phone, agentCode
  isActive: Joi.boolean().optional(),
});

module.exports = {
  createAgentSchema,
  updateAgentSchema,
  getAgentsQuerySchema,
};