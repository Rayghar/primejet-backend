// src/api/v1/runs/run.validation.js
const Joi = require('joi');

const reassignDriverSchema = Joi.object({
  driverId: Joi.string().uuid({ version: 'uuidv4' }).required(),
});

const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
});

const updateStopStatusSchema = Joi.object({
  status: Joi.string().required(),
  notes: Joi.string().optional().allow(''),
});

const runIdParamSchema = Joi.object({
  runId: Joi.string().uuid({ version: 'uuidv4' }).required(),
});

module.exports = {
  reassignDriverSchema,
  paginationSchema,
  updateStopStatusSchema,
  runIdParamSchema,
};