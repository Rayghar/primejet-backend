const express = require('express');
const router = express.Router();
const powerController = require('./power.controller');
const auth = require('../../../middleware/auth.middleware');

// Apply Auth Middleware (User must be logged in)
// NOTE: auth.middleware.js is a factory: authMiddleware(requiredRole?) => (req,res,next)
// Passing `auth` directly causes Express to call the factory with (req,res,next)
// instead of executing the returned middleware, leading to "unauth" requests / hangs.
router.use(auth());

// New: Get dynamic billers (used by Flutter for provider list)
router.get('/billers', powerController.getBillers);

router.post('/validate', powerController.validateMeter);
router.post('/order', powerController.createOrder);
router.post('/retry', powerController.retryVending);

module.exports = router;
