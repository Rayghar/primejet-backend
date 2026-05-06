// File: src/api/v1/users/user.validation.js
const Joi = require('joi');
const { ROLE_OPTIONS, BRANCH_SCOPE_OPTIONS } = require('../../../config/rolePermissions');

const passwordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
const nameRegex = /^[a-zA-Z\s]{2,50}$/;
const phoneRegex = /^\+?\d{10,15}$/;


const createUserSchema = Joi.object({
  name: Joi.string().trim().pattern(nameRegex).required().messages({
    'string.pattern.base': 'Name must contain only letters and spaces, and be 2-50 characters long.',
  }),
  email: Joi.string().email().trim().lowercase().required().messages({
    'string.base': 'Email should be a type of text.',
    'string.empty': 'Email cannot be empty.',
    'string.email': 'Email must be a valid email address.',
    'any.required': 'Email is a required field.',
  }),
  phone: Joi.string().trim().pattern(phoneRegex).required().messages({
    'string.base': 'Phone number should be a type of text.',
    'string.empty': 'Phone number cannot be empty.',
    'string.pattern.base': 'Phone number must be a valid international format.',
    'any.required': 'Phone number is a required field.',
  }),
  password: Joi.string()
    .pattern(passwordPattern)
    .required()
    .messages({
      'string.base': 'Password should be a type of text.',
      'string.empty': 'Password cannot be empty.',
      'string.pattern.base': 'Password must be at least 8 characters long, contain at least one uppercase letter, one lowercase letter, one number, and one special character.',
      'any.required': 'Password is a required field.',
    }),
  role: Joi.string().valid(...ROLE_OPTIONS).optional().messages({
    'any.only': `Role must be one of: ${ROLE_OPTIONS.join(', ')}.`,
  }),
  // Driver specific fields (optional for initial creation)
  vehicleModel: Joi.string().trim().max(50).optional().allow(''),
  licensePlate: Joi.string().trim().uppercase().max(20).optional().allow(''),
  serviceZone: Joi.string().trim().max(100).optional().allow(''),
  bankDetails: Joi.object({
    bankName: Joi.string().trim().max(50).required(),
    accountNumber: Joi.string().trim().pattern(/^[0-9]{10}$/).required(),
    accountName: Joi.string().trim().max(100).required(),
  }).optional().when('role', {
    is: 'driver',
    then: Joi.required().messages({
      'any.required': 'Bank details are required for drivers.',
    }),
    otherwise: Joi.forbidden(),
  }),
  referredByCode: Joi.string().trim().alphanum().uppercase().optional(), // Optional: for customer-to-customer referrals
  agentCode: Joi.string().trim().uppercase().min(4).max(12).alphanum().optional(), // Optional: for agent-based acquisition
}).messages({ // Global messages for createUserSchema
  'object.base': 'Request body must be a JSON object.',
});


const updateProfileSchema = Joi.object({
  name: Joi.string().pattern(nameRegex).optional().messages({
    'string.pattern.base': 'Name must contain only letters and spaces, and be 2-50 characters long.',
  }),
  phone: Joi.string().pattern(phoneRegex).optional().messages({
    'string.pattern.base': 'Phone number must be a valid format (e.g., +2348012345678).',
  }),
  password: Joi.string().min(6).optional().messages({ // New password
    'string.min': 'Password must be at least 6 characters long.',
  }),
});

const updateNotificationPreferencesSchema = Joi.object({
  orderUpdates: Joi.boolean().optional(),
  promotions: Joi.boolean().optional(),
}).min(1); // Requires at least one preference to be provided for an update

const adminCreateUserSchema = Joi.object({
  name: Joi.string().pattern(nameRegex).required().messages({
    'string.pattern.base': 'Name must contain only letters and spaces, and be 2-50 characters long.',
  }),
  email: Joi.string().email().max(254).required(),
  phone: Joi.string().pattern(phoneRegex).optional().allow('').messages({
    'string.pattern.base': 'Phone number must be a valid format (e.g., +2348012345678).',
  }),
  password: Joi.string().min(6).required(),
  role: Joi.string().valid(...ROLE_OPTIONS).required(),
  branchScope: Joi.string().valid(...BRANCH_SCOPE_OPTIONS).optional(),
  allowedBranches: Joi.array().items(Joi.object({
    branchId: Joi.string().allow('', null),
    branchCode: Joi.string().allow('', null),
    branchKey: Joi.string().allow('', null),
    branchName: Joi.string().allow('', null),
    id: Joi.string().allow('', null),
    name: Joi.string().allow('', null),
    label: Joi.string().allow('', null),
    code: Joi.string().allow('', null),
    key: Joi.string().allow('', null),
  }).unknown(true), Joi.string()).optional(),
  permissions: Joi.array().items(Joi.string()).optional(),
  permissionOverrides: Joi.object({
    add: Joi.array().items(Joi.string()).optional(),
    remove: Joi.array().items(Joi.string()).optional(),
  }).optional(),
  mustChangePassword: Joi.boolean().optional(),
  accessNotes: Joi.string().max(500).allow('', null).optional(),
  status: Joi.string().valid('active', 'inactive', 'suspended').optional(),
});

const adminUpdateUserSchema = Joi.object({
  name: Joi.string().pattern(nameRegex).optional().messages({
    'string.pattern.base': 'Name must contain only letters and spaces, and be 2-50 characters long.',
  }),
  email: Joi.string().email().max(254).optional(), // Usually email is not updatable or requires special process
  phone: Joi.string().pattern(phoneRegex).optional().messages({
    'string.pattern.base': 'Phone number must be a valid format (e.g., +2348012345678).',
  }),
  password: Joi.string().min(6).optional(), // For resetting/changing user's password by admin
  role: Joi.string().valid(...ROLE_OPTIONS).optional(),
  walletBalance: Joi.number().min(0).optional(),
  status: Joi.string().valid('active', 'inactive', 'suspended').optional(),
  isAvailableOnline: Joi.boolean().optional(), // For drivers
  bankDetails: Joi.object({ // For drivers
    bankCode: Joi.string().allow('', null),
    accountNumber: Joi.string().allow('', null),
    accountName: Joi.string().allow('', null),
  }).optional(),
  branchScope: Joi.string().valid(...BRANCH_SCOPE_OPTIONS).optional(),
  allowedBranches: Joi.array().items(Joi.object({
    branchId: Joi.string().allow('', null),
    branchCode: Joi.string().allow('', null),
    branchKey: Joi.string().allow('', null),
    branchName: Joi.string().allow('', null),
    id: Joi.string().allow('', null),
    name: Joi.string().allow('', null),
    label: Joi.string().allow('', null),
    code: Joi.string().allow('', null),
    key: Joi.string().allow('', null),
  }).unknown(true), Joi.string()).optional(),
  permissions: Joi.array().items(Joi.string()).optional(),
  permissionOverrides: Joi.object({
    add: Joi.array().items(Joi.string()).optional(),
    remove: Joi.array().items(Joi.string()).optional(),
  }).optional(),
  mustChangePassword: Joi.boolean().optional(),
  accessNotes: Joi.string().max(500).allow('', null).optional(),
}).min(1); // Require at least one field to update

const adminUpdateUserStatusSchema = Joi.object({
  status: Joi.string().valid('active', 'inactive', 'suspended').required(),
});

const updateDriverAvailabilitySchema = Joi.object({
  isAvailableOnline: Joi.boolean().required(),
});

const getDriverStatsSchema = Joi.object({
  period: Joi.string()
    .valid('weekly', 'monthly', 'allTime')
    .default('allTime'),
});

module.exports = {
  createUserSchema,
  updateProfileSchema,
  updateNotificationPreferencesSchema,
  adminCreateUserSchema,
  adminUpdateUserSchema,
  adminUpdateUserStatusSchema,
  updateDriverAvailabilitySchema,
  getDriverStatsSchema,
};