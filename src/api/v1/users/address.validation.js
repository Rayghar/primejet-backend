// src/api/v1/users/address.validation.js
const Joi = require('joi');

const createAddressSchema = Joi.object({
  label: Joi.string().min(2).max(50).required().messages({
    'string.base': 'Label must be a string.',
    'string.empty': 'Label is required.',
    'string.min': 'Label must be at least 2 characters long.',
    'string.max': 'Label cannot exceed 50 characters.',
    'any.required': 'Label is required.',
  }),
  fullAddress: Joi.string().min(5).max(255).required().messages({
    'string.base': 'Full address must be a string.',
    'string.empty': 'Full address is required.',
    'string.min': 'Full address must be at least 5 characters long.',
    'string.max': 'Full address cannot exceed 255 characters.',
    'any.required': 'Full address is required.',
  }),
  street: Joi.string().min(3).max(100).required().messages({
    'string.base': 'Street must be a string.',
    'string.empty': 'Street is required.',
    'string.min': 'Street must be at least 3 characters long.',
    'string.max': 'Street cannot exceed 100 characters.',
    'any.required': 'Street is required.',
  }),
  city: Joi.string().min(2).max(50).required().messages({
    'string.base': 'City must be a string.',
    'string.empty': 'City is required.',
    'string.min': 'City must be at least 2 characters long.',
    'string.max': 'City cannot exceed 50 characters.',
    'any.required': 'City is required.',
  }),
  state: Joi.string().min(2).max(50).required().messages({
    'string.base': 'State must be a string.',
    'string.empty': 'State is required.',
    'string.min': 'State must be at least 2 characters long.',
    'string.max': 'State cannot exceed 50 characters.',
    'any.required': 'State is required.',
  }),
  country: Joi.string().min(2).max(50).required().messages({
    'string.base': 'Country must be a string.',
    'string.empty': 'Country is required.',
    'string.min': 'Country must be at least 2 characters long.',
    'string.max': 'Country cannot exceed 50 characters.',
    'any.required': 'Country is required.',
  }),
  isDefault: Joi.boolean().optional(),
  latitude: Joi.number().min(-90).max(90).optional(),
  longitude: Joi.number().min(-180).max(180).optional(),
});

const updateAddressSchema = Joi.object({
  label: Joi.string().min(2).max(50).optional().messages({
    'string.base': 'Label must be a string.',
    'string.min': 'Label must be at least 2 characters long.',
    'string.max': 'Label cannot exceed 50 characters.',
  }),
  fullAddress: Joi.string().min(5).max(255).optional().messages({
    'string.base': 'Full address must be a string.',
    'string.min': 'Full address must be at least 5 characters long.',
    'string.max': 'Full address cannot exceed 255 characters.',
  }),
  street: Joi.string().min(3).max(100).optional().messages({
    'string.base': 'Street must be a string.',
    'string.min': 'Street must be at least 3 characters long.',
    'string.max': 'Street cannot exceed 100 characters.',
  }),
  city: Joi.string().min(2).max(50).optional().messages({
    'string.base': 'City must be a string.',
    'string.min': 'City must be at least 2 characters long.',
    'string.max': 'City cannot exceed 50 characters.',
  }),
  state: Joi.string().min(2).max(50).optional().messages({
    'string.base': 'State must be a string.',
    'string.min': 'State must be at least 2 characters long.',
    'string.max': 'State cannot exceed 50 characters.',
  }),
  country: Joi.string().min(2).max(50).optional().messages({
    'string.base': 'Country must be a string.',
    'string.min': 'Country must be at least 2 characters long.',
    'string.max': 'Country cannot exceed 50 characters.',
  }),
  isDefault: Joi.boolean().optional(),
  latitude: Joi.number().min(-90).max(90).optional(),
  longitude: Joi.number().min(-180).max(180).optional(),
}).min(1); // Requires at least one field to be provided for an update

// Schema for route parameters like addressId (if needed, though often handled by controller/service logic)
const addressIdParamSchema = Joi.object({
  addressId: Joi.string().uuid().required().messages({ // Assuming address IDs are UUIDs
    'string.guid': 'Address ID must be a valid UUID.',
    'any.required': 'Address ID parameter is required.',
  }),
});


module.exports = {
  createAddressSchema,
  updateAddressSchema,
  addressIdParamSchema, // Export if you plan to validate params separately
};