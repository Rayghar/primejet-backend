const express = require('express');
const Joi = require('joi');
const router = express.Router();

const userController = require('./user.controller');
const auth = require('../../../middleware/auth.middleware');
const validate = require('../../../middleware/validate.middleware');
const {
  registerCustomerSchema,
  registerDriverSchema,
  loginSchema,
  verifyOTPSchema,
  resetPasswordRequestSchema,
  resetPasswordSchema,
  updateProfileSchema,
  adminCreateUserSchema,
  updateUserRoleSchema,
} = require('./user.validation');

// --- Customer-specific routes ---
router.post('/register/customer', validate(registerCustomerSchema), userController.registerCustomer);
router.post('/login', validate(loginSchema), userController.login);
router.post('/verify-otp', validate(verifyOTPSchema), userController.verifyOtp);
router.post('/request-password-reset', validate(resetPasswordRequestSchema), userController.requestPasswordReset);
router.post('/reset-password', validate(resetPasswordSchema), userController.resetPassword);

// --- Driver-specific routes ---
router.post('/register/driver', validate(registerDriverSchema), userController.registerDriver);
router.put('/driver/availability', auth('driver'), userController.updateDriverAvailability);

// --- Admin-specific routes ---
router.get('/admin', auth('admin'), userController.adminGetUsers);
router.post('/admin', auth('admin'), validate(adminCreateUserSchema), userController.adminCreateUser);
router.put('/admin/:userId', auth('admin'), validate(updateUserRoleSchema), userController.adminUpdateUserRole);
router.put('/admin/:userId/status', auth('admin'), userController.adminUpdateUserStatus);
router.delete('/admin/:userId', auth('admin'), userController.deleteUser);

// --- Routes accessible by authenticated users (customer, driver, admin) ---
router.get('/me', auth(), userController.getMyProfile);
router.put('/me', auth(), validate(updateProfileSchema), userController.updateMyProfile);

// NEW: Route to register/update a user's FCM token
const fcmTokenSchema = Joi.object({
  fcmToken: Joi.string().required().messages({
    'any.required': 'FCM token is required.',
  }),
});

router.put(
  '/me/fcm-token',
  auth(),
  validate(fcmTokenSchema),
  userController.registerFcmToken
);

module.exports = router;