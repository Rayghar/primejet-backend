// File: src/api/v1/reports/report.validation.js

const Joi = require('joi');

// <<< START MODIFICATION HERE >>>
// Add 'overview' to the list of allowed report types
const allowedReportTypes = ['overview', 'salesOverview', 'orderStats', 'customerStats', 'driverStats', 'transactions']; //
// <<< END MODIFICATION HERE >>>

const allowedPeriods = ['daily', 'weekly', 'monthly', 'yearly', 'allTime', 'custom'];

const getReportQuerySchema = Joi.object({
  reportType: Joi.string().valid(...allowedReportTypes).required().messages({
    'any.required': 'Report type is required.',
    'any.only': `Invalid report type specified. Allowed types are: ${allowedReportTypes.join(', ')}.`,
  }),
  period: Joi.string().valid(...allowedPeriods).required().messages({
    'any.required': 'Period is required.',
    'any.only': `Invalid period specified. Allowed periods are: ${allowedPeriods.join(', ')}.`,
  }),
  startDate: Joi.date().iso().optional().messages({
    'date.format': 'Start date must be in ISO 8601 format (YYYY-MM-DDTHH:mm:ssZ).',
  }),
  endDate: Joi.date().iso().optional().greater(Joi.ref('startDate')).messages({
    'date.format': 'End date must be in ISO 8601 format (YYYY-MM-DDTHH:mm:ssZ).',
    'date.greater': 'End date must be after start date.',
  }),
});

const exportReportQuerySchema = Joi.object({
  reportType: Joi.string().valid(...allowedReportTypes).required().messages({
    'any.required': 'Report type is required for export.',
    'any.only': `Invalid report type specified for export. Allowed types are: ${allowedReportTypes.join(', ')}.`,
  }),
  startDate: Joi.date().iso().required().messages({
    'any.required': 'Start date is required for export.',
    'date.format': 'Start date must be in ISO 8601 format (YYYY-MM-DDTHH:mm:ssZ).',
  }),
  endDate: Joi.date().iso().required().greater(Joi.ref('startDate')).messages({
    'any.required': 'End date is required for export.',
    'date.format': 'End date must be in ISO 8601 format (YYYY-MM-DDTHH:mm:ssZ).',
    'date.greater': 'End date must be after start date.',
  }),
  format: Joi.string().valid('xlsx', 'csv').default('xlsx').optional(),
});


module.exports = {
  getReportQuerySchema,
  exportReportQuerySchema,
};