// File: src/api/v1/utilities/power.routes.js
const express = require('express');
const router = express.Router();
const powerController = require('./power.controller');
const authMiddleware = require('../../../middleware/auth.middleware');

// Apply Auth Middleware (User must be logged in)
router.use(authMiddleware());

/**
 * (Optional Discovery)
 * @route   GET /api/v1/power/products?category=ELECTRICITY
 * @desc    Returns electricity products for UI dropdown (fallback safe)
 * @access  Private
 */
router.get('/products', powerController.getProducts);

/**
 * @route   POST /api/v1/power/validate
 * @desc    Validate a meter number via Monnify Bills Payment
 * @access  Private
 */
router.post('/validate', powerController.validateMeter);

/**
 * @route   POST /api/v1/power/order
 * @desc    Create a pending electricity order (before payment)
 * @access  Private
 */
router.post('/order', powerController.createOrder);

/**
 * @route   POST /api/v1/power/retry
 * @desc    Admin only: Retry vending for a failed/stuck order
 * @access  Private (Admin)
 */
router.post('/retry', powerController.retryVending);

router.get('/billers', powerController.getBillers);
router.get('/products', powerController.getProducts);


module.exports = router;
