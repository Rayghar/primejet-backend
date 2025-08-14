// src/api/v2/analytics/analytics.validation.js
const Joi = require('joi');

// Schema for dashboard KPIs (no specific input validation needed for GET request)
const getDashboardKpisSchema = Joi.object({});

// Schema for sales report (no specific input validation needed for GET request)
const getSalesReportSchema = Joi.object({});

// Schema for sales by payment method (no specific input validation needed for GET request)
const getSalesByPaymentMethodSchema = Joi.object({});

// Schema for sales by branch (no specific input validation needed for GET request)
const getSalesByBranchSchema = Joi.object({});

// Schema for top-selling products (no specific input validation needed for GET request)
const getTopSellingProductsSchema = Joi.object({});

module.exports = {
  getDashboardKpisSchema,
  getSalesReportSchema,
  getSalesByPaymentMethodSchema,
  getSalesByBranchSchema,
  getTopSellingProductsSchema,
};