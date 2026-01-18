// File: src/api/v1/config/config.routes.js
const express = require('express');
const configController = require('./config.controller');
const authMiddleware = require('../../../middleware/auth.middleware');
const validate = require('../../../middleware/validate.middleware');
const { updateSystemConfigSchema, updatePaymentGatewaySchema } = require('./config.validation');

const router = express.Router();

console.log('[CONFIG_ROUTES] Registering system configuration routes...');

// GET /api/v1/config - Get general system configuration (for any authenticated user)
router.get(
  '/',
  //authMiddleware(), 
  configController.getSystemConfig
);

// PUT /api/v1/config - Update general system configuration (admin only)
router.put(
  '/',
  authMiddleware('admin'),
  validate(updateSystemConfigSchema),
  configController.updateSystemConfig
);

// PATCH /api/v1/config/payment-gateway - Update the active payment gateway (admin only)
router.patch(
    '/payment-gateway',
    authMiddleware('admin'),
    validate(updatePaymentGatewaySchema),
    configController.updatePaymentGateway
);

console.log('[CONFIG_ROUTES] System configuration routes registered.');

module.exports = router;