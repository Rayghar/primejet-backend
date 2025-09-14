// src/api/v1/users/user.controller.js
const userService = require('./user.service'); // Path to co-located service
const HttpError = require('../../../utils/HttpError'); // Path to global HttpError utility

// Controller for the authenticated user's own profile
const getMyProfile = async (req, res, next) => {
  try {
    // FIX: Replaced non-existent `getUserById` with the correct `getProfile` method from `user.service`.
    const user = await userService.getProfile(req.user.id); 
    if (!user) {
      throw new HttpError(404, 'User profile not found.');
    }
    res.status(200).json(user);
  } catch (error) {
    next(error);
  }
};

const updateFcmToken = async (req, res, next) => {
  try {
    const { fcmToken } = req.body;
    await userService.updateFcmToken(req.user.id, fcmToken);
    res.status(200).json({ message: 'FCM token updated successfully.' });
  } catch (error) {
    next(error);
  }
};

const updateProfile = async (req, res, next) => {
  try {
    const result = await userService.updateProfile(req.user.id, req.body);
    res.status(200).json(result);
  } catch (error) {
    // console.error('[USER_CONTROLLER] Update profile error:', error.message); // Original log
    next(error);
  }
};

// Controller for notification preferences
const getNotificationPreferences = async (req, res, next) => {
  try {
    const preferences = await userService.getNotificationPreferences(req.user.id);
    res.status(200).json(preferences);
  } catch (error) {
    // console.error('[USER_CONTROLLER] Get notification preferences error:', error.message); // Original log
    next(error);
  }
};

const updateNotificationPreferences = async (req, res, next) => {
  try {
    const result = await userService.updateNotificationPreferences(req.user.id, req.body);
    res.status(200).json(result);
  } catch (error) {
    // console.error('[USER_CONTROLLER] Update notification preferences error:', error.message); // Original log
    next(error);
  }
};

// Controllers for Admin user management
const adminGetUsers = async (req, res, next) => {
  try {
    const { role, search, page = 1, limit = 10 } = req.query;
    const result = await userService.adminGetUsers({
      role,
      search,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
    res.status(200).json(result);
  } catch (error) {
    // console.error('[USER_CONTROLLER] Admin get users error:', error.message); // Original log
    next(error);
  }
};

const adminGetUser = async (req, res, next) => {
  try {
    const user = await userService.adminGetUser(req.params.userId);
    res.status(200).json(user);
  } catch (error) {
    // console.error('[USER_CONTROLLER] Admin get user error:', error.message); // Original log
    next(error);
  }
};

const adminCreateUser = async (req, res, next) => {
  try {
    const user = await userService.adminCreateUser(req.body);
    // Consistent with your auth controller, returning { userId }
    res.status(201).json({ userId: user.id, message: 'User created successfully by admin.' });
  } catch (error) {
    // console.error('[USER_CONTROLLER] Admin create user error:', error.message); // Original log
    next(error);
  }
};

const adminUpdateUser = async (req, res, next) => {
  try {
    const result = await userService.adminUpdateUser(req.params.userId, req.body);
    res.status(200).json(result);
  } catch (error) {
    // console.error('[USER_CONTROLLER] Admin update user error:', error.message); // Original log
    next(error);
  }
};

const adminUpdateUserStatus = async (req, res, next) => {
  try {
    // Ensure status is passed correctly from the request body
    const { status } = req.body;
    if (!status) {
        return next(new HttpError(400, 'Status is required in the request body.'));
    }
    const result = await userService.adminUpdateUserStatus(req.params.userId, status);
    res.status(200).json(result);
  } catch (error) {
    // console.error('[USER_CONTROLLER] Admin update user status error:', error.message); // Original log
    next(error);
  }
};

const deleteUserById = async (req, res, next) => {
  try {
    // Role check might be slightly redundant if route is protected by authMiddleware('admin'),
    // but acts as a good defense-in-depth.
    if (req.user.role !== 'admin') {
      return next(new HttpError(403, 'Insufficient permissions to delete a user.'));
    }
    const result = await userService.deleteUserById(req.params.userId);
    res.status(200).json(result);
  } catch (error) {
    // console.error('[USER_CONTROLLER] Delete user error:', error.message); // Original log
    next(error);
  }
};

// Controller for Driver specific actions
const updateDriverAvailability = async (req, res, next) => {
  try {
    // Role check for defense-in-depth, even if route is protected by authMiddleware('driver').
    if (req.user.role !== 'driver') {
        return next(new HttpError(403, 'Only drivers can update their availability.'));
    }
    // Ensure isAvailableOnline is passed correctly from the request body
    const { isAvailableOnline } = req.body;
    if (typeof isAvailableOnline !== 'boolean') {
        return next(new HttpError(400, 'isAvailableOnline must be a boolean value (true or false).'));
    }
    const result = await userService.updateDriverAvailability(req.user.id, isAvailableOnline);
    res.status(200).json(result);
  } catch (error) {
    // console.error('[USER_CONTROLLER] Update driver availability error:', error.message); // Original log
    next(error);
  }
};

const getDriverStats = async (req, res, next) => {
  try {
    const stats = await userService.getDriverStats(req.user.id, req.query.period);
    res.status(200).json(stats);
  } catch (error) {
    next(error);
  }
};



module.exports = {
  updateProfile,
  getNotificationPreferences,
  updateNotificationPreferences,
  adminGetUsers,
  adminGetUser,
  adminCreateUser,
  adminUpdateUser,
  adminUpdateUserStatus,
  deleteUserById,
  updateDriverAvailability,
  getDriverStats,
  updateFcmToken,
  getMyProfile,
};