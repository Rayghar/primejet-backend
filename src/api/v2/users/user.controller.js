// src/api/v2/users/user.controller.js
const userService = require('./user.service'); // Should point to v2 service now (which re-exports v1 functions)
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');

// Fetches all users from the database. Mirrors v1/users/admin route.
const adminGetUsers = async (req, res, next) => {
  try {
    const { role, search, page, limit } = req.query;
    const result = await userService.adminGetUsers({ role, search, page, limit });
    res.status(200).json(result);
  } catch (error) {
    logger.error('Error in adminGetUsers (v2):', error);
    next(new HttpError(500, 'Failed to fetch users.'));
  }
};

// Creates a new user. Mirrors v1/users/admin route but returns a simplified payload.
const adminCreateUser = async (req, res, next) => {
  try {
    const newUser = await userService.registerUser(req.body, { allowFirstAdmin: false });
    res.status(201).json({ id: newUser.id, message: 'User created successfully.' });
  } catch (error) {
    logger.error('Error in adminCreateUser (v2):', error);
    next(error);
  }
};

/**
 * Fetches a single user's detailed profile.
 * This function handles both '/admin/:userId' and '/me' endpoints.
 * For '/me', req.params.userId will be undefined, so it uses req.user.id from the JWT.
 */
const adminGetUser = async (req, res, next) => {
  try {
    // Determine the target userId: from params for admin view, or from JWT for '/me'
    // CORRECTED: Use req.user.id instead of req.user.userId
    const targetUserId = req.params.userId || req.user.id; 

    if (!targetUserId) {
        throw new HttpError(400, 'User ID is required to fetch profile.');
    }

    const user = await userService.adminGetUser(targetUserId); // Use the v2 userService's adminGetUser
    
    // Ensure the role is explicitly returned for the frontend's sidebar logic
    res.status(200).json({ ...user, role: user.role }); 
  } catch (error) {
    logger.error(`Error in adminGetUser (v2) for userId ${req.params.userId || req.user?.id}:`, error); // Log req.user.id
    next(error);
  }
};

/**
 * Fetches driver statistics for a given driver ID and period.
 */
const getDriverStats = async (req, res, next) => {
  try {
    const { driverId } = req.params;
    const { period } = req.query; // 'weekly', 'monthly', 'allTime'
    const stats = await userService.getDriverStats(driverId, period); // Call the v2 userService
    res.status(200).json(stats);
  } catch (error) {
    logger.error(`Error in getDriverStats (v2) for driver ${req.params.driverId}:`, error);
    next(error);
  }
};

// Updates a user's role. A new, dedicated endpoint for the web app.
const adminUpdateUserRole = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { role } = req.body;
    const updatedUser = await userService.adminUpdateUser(userId, { role });
    res.status(200).json({ message: 'User role updated.', user: { id: updatedUser.id, role: updatedUser.role } });
  } catch (error) {
    logger.error(`Error in adminUpdateUserRole (v2) for userId ${req.params.userId}:`, error);
    next(error);
  }
};

// Updates general user details (name, phone, status, walletBalance, etc.)
const adminUpdateUser = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const result = await userService.adminUpdateUser(userId, req.body);
    res.status(200).json(result);
  } catch (error) {
    logger.error(`Error in adminUpdateUser (v2) for userId ${req.params.userId}:`, error);
    next(error);
  }
};

// Deletes a user by ID.
const deleteUserById = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const result = await userService.deleteUserById(userId);
    res.status(200).json(result);
  } catch (error) {
    logger.error(`Error in deleteUserById (v2) for userId ${req.params.userId}:`, error);
    next(error);
  }
};

module.exports = {
  adminGetUsers,
  adminCreateUser,
  adminGetUser,
  adminUpdateUserRole,
  adminUpdateUser,
  deleteUserById,
  getDriverStats,
};