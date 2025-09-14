// src/api/v1/users/user.routes.js
const express = require('express');
const userController = require('./user.controller'); // Path to co-located controller
const authMiddleware = require('../../../middleware/auth.middleware'); // Path to global auth middleware
const validate = require('../../../middleware/validate.middleware'); // Path to global validate middleware
const { getDriverStatsSchema } = require('./user.validation');
const {
  updateProfileSchema,
  updateNotificationPreferencesSchema,
  adminCreateUserSchema,
  adminUpdateUserSchema,
  adminUpdateUserStatusSchema,
  updateDriverAvailabilitySchema,
} = require('./user.validation'); // Path to co-located validation schemas

const router = express.Router();

console.log('[USER_ROUTES] Registering user routes...');

// Authenticated user's own profile routes
router.get(
    '/me',
    authMiddleware(), // Requires any authenticated user
    // FIX: Use the correct controller function name `getMyProfile`
    userController.getMyProfile
);
router.put(
    '/me',
    authMiddleware(),
    validate(updateProfileSchema), // Validate request body
    userController.updateProfile
);

router.get(
    '/me/notification-preferences',
    authMiddleware(),
    userController.getNotificationPreferences
);
router.put(
    '/me/notification-preferences',
    authMiddleware(),
    validate(updateNotificationPreferencesSchema), // Validate request body
    userController.updateNotificationPreferences
);

// Driver specific routes
router.put(
    '/driver/availability',
    authMiddleware('driver'), // Requires driver role
    validate(updateDriverAvailabilitySchema), // Validate request body
    userController.updateDriverAvailability
);

// Admin user management routes
router.get(
    '/admin',
    authMiddleware('admin'), // Requires admin role
    userController.adminGetUsers
);
router.post(
    '/admin',
    authMiddleware('admin'),
    validate(adminCreateUserSchema), // Validate request body
    userController.adminCreateUser
);

router.get(
    '/admin/:userId',
    authMiddleware('admin'),
    userController.adminGetUser
);
router.put(
    '/admin/:userId',
    authMiddleware('admin'),
    validate(adminUpdateUserSchema), // Validate request body
    userController.adminUpdateUser
);
router.put(
    '/admin/:userId/status',
    authMiddleware('admin'),
    validate(adminUpdateUserStatusSchema), // Validate request body
    userController.adminUpdateUserStatus
);
router.delete(
    '/admin/:userId',
    authMiddleware('admin'),
    userController.deleteUserById
);

// Fetch driver stats
router.get(
    '/me/stats',
    authMiddleware('driver'), // Ensure only drivers can access this
    validate(getDriverStatsSchema, 'query'), // Optional: validate query params
    userController.getDriverStats // Use the real controller
);

console.log('[USER_ROUTES] User routes registered.');

module.exports = router;