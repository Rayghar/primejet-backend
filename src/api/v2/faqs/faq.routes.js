// src/api/v1/faqs/faq.routes.js
const express = require('express');
const faqController = require('./faq.controller'); // Path to co-located controller
const authMiddleware = require('../../../middleware/auth.middleware'); // Path to global auth middleware
const validate = require('../../../middleware/validate.middleware'); // Path to global validate middleware
const {
  createFAQSchema,
  updateFAQSchema,
  getPublicFAQsSchema, // For validating query params on the public GET route
  // faqIdParamSchema, // Optional for param validation at route level
} = require('./faq.validation'); // Path to co-located validation schemas

const router = express.Router();

console.log('[FAQ_ROUTES] Registering FAQ routes...');

// Public route to get FAQs (e.g., filtered by category/role)
router.get(
  '/public',
  validate(getPublicFAQsSchema, 'query'), // Validate query parameters
  faqController.getPublicFAQs
);

// Admin routes for managing FAQs
router.post(
  '/',
  authMiddleware('admin'),
  validate(createFAQSchema), // Validate request body for creating an FAQ
  faqController.createFAQ
);

router.get(
  '/', // Admin route to get all FAQs (paginated)
  authMiddleware('admin'),
  faqController.getFAQs
);

router.get(
  '/:faqId',
  authMiddleware('admin'),
  // Optional: validate(faqIdParamSchema, 'params') if you want to validate faqId format here
  faqController.getFAQ
);

router.put(
  '/:faqId',
  authMiddleware('admin'),
  // Optional: validate(faqIdParamSchema, 'params')
  validate(updateFAQSchema), // Validate request body for updating an FAQ
  faqController.updateFAQ
);

// Note: DELETE route for FAQs was not in your original set of files.
// If needed, it would look like this:
// router.delete(
//   '/:faqId',
//   authMiddleware('admin'),
//   // Optional: validate(faqIdParamSchema, 'params'),
//   faqController.deleteFAQ // You would need to add this controller and service method
// );

console.log('[FAQ_ROUTES] FAQ routes registered.');

module.exports = router;