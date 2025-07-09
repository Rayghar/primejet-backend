// src/api/v1/wallet/wallet.routes.js
const express = require('express');
const walletController = require('./wallet.controller'); // Path to co-located controller
const authMiddleware = require('../../../middleware/auth.middleware'); // Path to global auth middleware
const validate = require('../../../middleware/validate.middleware'); // Path to global validate middleware
const {
  initializeTopUpSchema,
  confirmTopUpSchema,
  adminCreditWalletSchema, // <<< IMPORT NEW SCHEMA
} = require('./wallet.validation'); // Path to co-located validation schemas

const router = express.Router();

console.log('[WALLET_ROUTES] Registering wallet routes...');

// All routes in this file are for the authenticated customer's wallet.
// They will be mounted under a base path like /api/v1/wallet in app.js.

router.get(
  '/',
  authMiddleware('customer'),
  walletController.getWallet
);

router.post(
  '/top-up/initialize',
  authMiddleware('customer'),
  validate(initializeTopUpSchema), // Validate the 'amount' in the request body
  walletController.initializeTopUp
);

router.post(
  '/top-up/confirm',
  authMiddleware('customer'),
  validate(confirmTopUpSchema), // Validate 'transactionId' and 'paymentGatewayReference'
  walletController.confirmTopUp
);

router.post('/admin/credit', authMiddleware('admin'), validate(adminCreditWalletSchema), walletController.adminCreditWallet);
// This route allows an admin to credit a user's wallet.
// It requires the admin to provide an amount, description, and either a userId or a role (customer/driver).

console.log('[WALLET_ROUTES] Wallet routes registered.');

module.exports = router;