const express = require('express');
const addressController = require('./address.controller');
const authMiddleware = require('../../../middleware/auth.middleware');
const validate = require('../../../middleware/validate.middleware');
const {
  createAddressSchema,
  updateAddressSchema,
} = require('./address.validation');

const router = express.Router();

console.log('[ADDRESS_ROUTES] Registering address routes...');

/**
 * =========================================================
 * GOOGLE PLACES ROUTES (MUST COME FIRST)
 * =========================================================
 * These MUST be before `/:addressId` routes
 */

// Autocomplete (used by web address input)
router.get(
  '/places/autocomplete',
  //authMiddleware('customer'),
  addressController.placesAutocomplete
);

// Place details → resolve lat/lng
router.get(
  '/places/details/:placeId',
  //authMiddleware('customer'),
  addressController.placeDetails
);

/**
 * =========================================================
 * USER ADDRESS ROUTES
 * =========================================================
 */

// Get all addresses for logged-in user
router.get(
  '/',
  authMiddleware('customer'),
  addressController.getAddresses
);

// Create address (supports frontend + backend geocoding)
router.post(
  '/',
  authMiddleware('customer'),
  validate(createAddressSchema),
  addressController.createAddress
);

// Update address
router.put(
  '/:addressId',
  authMiddleware('customer'),
  validate(updateAddressSchema),
  addressController.updateAddress
);

// Delete address
router.delete(
  '/:addressId',
  authMiddleware('customer'),
  addressController.deleteAddress
);

// Set default address
router.post(
  '/:addressId/default',
  authMiddleware('customer'),
  addressController.setDefaultAddress
);

console.log('[ADDRESS_ROUTES] Address routes registered.');

module.exports = router;
