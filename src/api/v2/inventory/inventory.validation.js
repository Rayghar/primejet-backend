// src/api/v2/inventory/inventory.validation.js
const Joi = require('joi');

// Schema for adding a new asset
const addAssetSchema = Joi.object({
  name: Joi.string().min(3).max(100).required(),
  type: Joi.string().valid('Plant', 'Delivery Van', 'Bobtail Truck', 'Office Equipment', 'Other').required(),
  cost: Joi.number().min(0).required(),
  purchaseDate: Joi.date().iso().required(), // ISO 8601 format (YYYY-MM-DD)
});

// Schema for adding a new loan
const addLoanSchema = Joi.object({
  name: Joi.string().min(3).max(100).required(),
  principal: Joi.number().min(0).required(),
  interestRate: Joi.number().min(0).max(100).required(),
  term: Joi.number().integer().min(1).required(),
  disbursementDate: Joi.date().iso().optional(),
});

// Schema for adding a new cylinder batch
const addCylinderSchema = Joi.object({
  size: Joi.string().max(20).required(),
  quantity: Joi.number().integer().min(0).required(),
});

// Schema for adding a new stock-in (bulk LPG purchase)
const addStockInSchema = Joi.object({
  quantityKg: Joi.number().min(0).required(),
  supplier: Joi.string().max(100).required(),
  purchaseDate: Joi.date().iso().required(),
  costPerKg: Joi.number().min(0).required(),
  targetSalePricePerKg: Joi.number().min(0).required(),
});

module.exports = {
  addAssetSchema,
  addLoanSchema,
  addCylinderSchema,
  addStockInSchema,
};