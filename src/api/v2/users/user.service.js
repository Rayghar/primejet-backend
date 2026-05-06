// src/api/v2/users/user.service.js

// Import all necessary user service functions from the v1 service file.
// This allows v2 controllers to use these functions without duplicating logic.
const {
    getProfile,
    updateProfile,
    getNotificationPreferences,
    updateNotificationPreferences,
    adminGetUsers,
    adminGetUser,
    adminCreateUser,
    adminUpdateUser,
    adminUpdateUserStatus,
    deleteUser: deleteUserByIdV1, // Rename to avoid conflict
    updateDriverAvailability,
    getDriverStats,
    registerUser, // This is the original registerUser from v1
    findUserByCredentials // This is the function we added for login
} = require('../../v1/users/user.service');

// Re-export all functions that are needed for the v2 API.
// This makes them accessible to v2 controllers while keeping the implementation in v1.
module.exports = {
    getProfile,
    updateProfile,
    getNotificationPreferences,
    updateNotificationPreferences,
    adminGetUsers,
    adminGetUser,
    adminCreateUser,
    adminUpdateUser,
    adminUpdateUserStatus,
    deleteUserById: deleteUserByIdV1, // Expose the v1 deleteUser as deleteUserById for v2
    updateDriverAvailability,
    getDriverStats,
    registerUser, // Expose the original registerUser (for adminCreateUser in v2 controller)
    findUserByCredentials // Crucial for v2 login
};