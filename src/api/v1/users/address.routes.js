// src/api/v1/users/address.routes.js
const express = require('express');
const addressController = require('./address.controller'); // Path to co-located controller
const authMiddleware = require('../../../middleware/auth.middleware'); // Path to global auth middleware
const validate = require('../../../middleware/validate.middleware'); // Path to global validate middleware
const {
  createAddressSchema,
  updateAddressSchema,
  // addressIdParamSchema, // We'll primarily use body validation here; param validation can be in controller/service
} = require('./address.validation'); // Path to co-located validation schemas

const router = express.Router();

console.log('[ADDRESS_ROUTES] Registering address routes...');

// Routes for the authenticated user's addresses
// These will be mounted under a base path like /api/v1/addresses in app.js

router.get(
  '/',
  authMiddleware('customer'), // Only customers can get their addresses
  addressController.getAddresses
);

router.post(
  '/',
  authMiddleware('customer'),
  validate(createAddressSchema), // Validate request body for creating an address
  addressController.createAddress
);

router.put(
  '/:addressId',
  authMiddleware('customer'),
  // Optional: validate(addressIdParamSchema, 'params') if you want to validate addressId format here
  validate(updateAddressSchema), // Validate request body for updating an address
  addressController.updateAddress
);

router.post(
  '/:addressId/default',
  authMiddleware('customer'),
  // Optional: validate(addressIdParamSchema, 'params')
  addressController.setDefaultAddress
);

console.log('[ADDRESS_ROUTES] Address routes registered.');

module.exports = router;