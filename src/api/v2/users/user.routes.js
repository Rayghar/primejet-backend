// src/api/v2/users/user.routes.js
const express = require('express');
const userController = require('./user.controller');
const authMiddleware = require('../../../middleware/auth.middleware');
const validate = require('../../../middleware/validate.middleware');
const { adminCreateUserSchema, adminUpdateUserRoleSchema, adminUpdateUserSchema, userIdParamSchema, driverIdParamSchema } = require('./user.validation');
const { getDriverStatsSchema } = require('./user.validation'); // Import getDriverStatsSchema
const { requirePermission } = require('../../../middleware/permission.middleware');

const router = express.Router();

// Admin route to get all users
router.get('/admin', authMiddleware('admin'), requirePermission('admin.users.view'), userController.adminGetUsers);

// Admin route to invite/create a new user
router.post('/admin', authMiddleware('admin'), requirePermission('admin.users.create'), validate(adminCreateUserSchema), userController.adminCreateUser);

// Admin route to get branch/plant options for Staff Access assignment.
// Must be declared before /admin/:userId so Express does not treat 'branch-options' as a userId.
router.get('/admin/branch-options', authMiddleware('admin'), requirePermission('admin.users.view'), userController.adminGetBranchOptions);

// Admin route to get a single user's detailed profile by ID
router.get('/admin/:userId', authMiddleware('admin'), requirePermission('admin.users.view'), validate(userIdParamSchema, 'params'), userController.adminGetUser);

// Admin route to update a user's role (specific update)
router.put('/admin/:userId/role', authMiddleware('admin'), requirePermission('admin.users.update'), validate(userIdParamSchema, 'params'), validate(adminUpdateUserRoleSchema), userController.adminUpdateUserRole);

// Admin route to update general user details
router.put('/admin/:userId', authMiddleware('admin'), requirePermission('admin.users.update'), validate(userIdParamSchema, 'params'), validate(adminUpdateUserSchema), userController.adminUpdateUser);

// Admin route to delete a user
router.delete('/admin/:userId', authMiddleware('admin'), requirePermission('admin.users.delete'), validate(userIdParamSchema, 'params'), userController.deleteUserById);

// Route to get the currently authenticated user's profile
router.get('/me', authMiddleware(), userController.adminGetUser);

// NEW: Route to get driver statistics (can be used by admin/manager/driver)
router.get('/drivers/:driverId/stats', authMiddleware(['admin', 'manager', 'driver']), validate(driverIdParamSchema, 'params'), validate(getDriverStatsSchema, 'query'), userController.getDriverStats);

module.exports = router;