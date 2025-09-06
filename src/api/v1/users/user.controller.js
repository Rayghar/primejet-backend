// src/api/v1/users/user.controller.js

const userService = require('./user.service');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');

const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const { token, user } = await userService.loginUserWithEmailAndPassword(email, password);
    res.status(200).json({ token, ...user });
  } catch (error) {
    next(error);
  }
};

const registerCustomer = async (req, res, next) => {
  try {
    const userData = req.body;
    const newUser = await userService.registerCustomer(userData);
    res.status(201).json({ message: 'User registered successfully. An OTP has been sent to your email for verification.', user: newUser });
  } catch (error) {
    next(error);
  }
};

const registerDriver = async (req, res, next) => {
  try {
    const userData = req.body;
    const newDriver = await userService.registerDriver(userData);
    res.status(201).json({ message: 'Driver registered successfully. Pending admin approval.', user: newDriver });
  } catch (error) {
    next(error);
  }
};

const verifyOtp = async (req, res, next) => {
  try {
    const { email, otp } = req.body;
    const user = await userService.verifyOtp(email, otp);
    res.status(200).json({ message: 'OTP verified successfully.', user });
  } catch (error) {
    next(error);
  }
};

const requestPasswordReset = async (req, res, next) => {
  try {
    const { email } = req.body;
    const result = await userService.requestPasswordReset(email);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

const resetPassword = async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;
    await userService.resetPassword(token, newPassword);
    res.status(200).json({ message: 'Password reset successfully.' });
  } catch (error) {
    next(error);
  }
};

const getMyProfile = async (req, res, next) => {
  try {
    const user = await userService.getUserById(req.user.id);
    if (!user) {
      throw new HttpError(404, 'User profile not found.');
    }
    res.status(200).json(user);
  } catch (error) {
    next(error);
  }
};

const updateMyProfile = async (req, res, next) => {
  try {
    const updatedUser = await userService.updateUser(req.user.id, req.body);
    res.status(200).json({ message: 'Profile updated successfully.', user: updatedUser });
  } catch (error) {
    next(error);
  }
};

const updateDriverAvailability = async (req, res, next) => {
  try {
    const { isAvailableOnline } = req.body;
    await userService.updateDriverAvailability(req.user.id, isAvailableOnline);
    res.status(200).json({ message: 'Driver availability updated successfully.' });
  } catch (error) {
    next(error);
  }
};

const adminGetUsers = async (req, res, next) => {
  try {
    const { role, page, limit, search, status } = req.query;
    const users = await userService.adminGetUsers({ role, page: parseInt(page, 10), limit: parseInt(limit, 10), search, status });
    res.status(200).json(users);
  } catch (error) {
    next(error);
  }
};

const adminCreateUser = async (req, res, next) => {
  try {
    const user = await userService.adminCreateUser(req.body);
    res.status(201).json(user);
  } catch (error) {
    next(error);
  }
};

const adminUpdateUserRole = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { role } = req.body;
    const updatedUser = await userService.adminUpdateUserRole(userId, role);
    res.status(200).json(updatedUser);
  } catch (error) {
    next(error);
  }
};

const adminUpdateUserStatus = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { status } = req.body;
    const updatedUser = await userService.adminUpdateUserStatus(userId, status);
    res.status(200).json(updatedUser);
  } catch (error) {
    next(error);
  }
};

const deleteUser = async (req, res, next) => {
  try {
    await userService.deleteUser(req.params.userId);
    res.status(200).json({ message: 'User deleted successfully.' });
  } catch (error) {
    next(error);
  }
};

const registerFcmToken = async (req, res, next) => {
  try {
    const { fcmToken } = req.body;
    const userId = req.user.id;
    await userService.registerFcmToken(userId, fcmToken);
    res.status(200).json({ message: 'FCM token registered successfully.' });
  } catch (error) {
    next(error);
  }
};


module.exports = {
  login,
  registerCustomer,
  registerDriver,
  verifyOtp,
  requestPasswordReset,
  resetPassword,
  getMyProfile,
  updateMyProfile,
  updateDriverAvailability,
  adminGetUsers,
  adminCreateUser,
  adminUpdateUserRole,
  adminUpdateUserStatus,
  deleteUser,
  registerFcmToken
};