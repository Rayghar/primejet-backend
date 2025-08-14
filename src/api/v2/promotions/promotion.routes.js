// src/api/v1/promotions/promotion.routes.js
const express = require('express');
const promotionController = require('./promotion.controller'); // Path to co-located controller
const authMiddleware = require('../../../middleware/auth.middleware'); // Path to global auth middleware
const validate = require('../../../middleware/validate.middleware'); // Path to global validate middleware
const {
  createPromotionSchema,
  updatePromotionSchema,
  // promoIdParamSchema, // Optional for param validation at route level
} = require('./promotion.validation'); // Path to co-located validation schemas

const router = express.Router();

console.log('[PROMOTION_ROUTES] Registering promotion routes...');

// Public route to get active promotions
router.get(
  '/active',
  promotionController.getActivePromotions
);

// Admin routes for managing promotions
router.post(
  '/',
  authMiddleware('admin'),
  validate(createPromotionSchema), // Validate request body for creating a promotion
  promotionController.createPromotion
);

router.get(
  '/',
  authMiddleware('admin'),
  promotionController.getPromotions // Get all promotions (paginated)
);

router.get(
  '/:promoId',
  authMiddleware('admin'),
  // Optional: validate(promoIdParamSchema, 'params') if you want to validate promoId format here
  promotionController.getPromotion
);

router.put(
  '/:promoId',
  authMiddleware('admin'),
  // Optional: validate(promoIdParamSchema, 'params')
  validate(updatePromotionSchema), // Validate request body for updating a promotion
  promotionController.updatePromotion
);

// Note: DELETE route for promotions was not in your original set of files.
// If needed, it would look like this:
// router.delete(
//   '/:promoId',
//   authMiddleware('admin'),
//   // Optional: validate(promoIdParamSchema, 'params'),
//   promotionController.deletePromotion // You would need to add this controller and service method
// );

console.log('[PROMOTION_ROUTES] Promotion routes registered.');

module.exports = router;