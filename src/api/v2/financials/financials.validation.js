// src/api/v2/financials/financials.validation.js
const Joi = require('joi');

// Schema for fetching financial statements (e.g., for branchId query param)
const getFinancialStatementsSchema = Joi.object({
  branchId: Joi.string().optional().allow('all').description('Optional branch ID to filter financial statements.'),
});

// Schema for fetching revenue assurance report (no specific params for now)
const getRevenueAssuranceReportSchema = Joi.object({});

// Schema for fetching tax compliance report (no specific params for now)
const getTaxComplianceReportSchema = Joi.object({});


module.exports = {
  getFinancialStatementsSchema,
  getRevenueAssuranceReportSchema,
  getTaxComplianceReportSchema,
};