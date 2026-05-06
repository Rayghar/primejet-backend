// src/api/v2/auth/auth.controller.js
const authService = require('../../v1/auth/auth.service'); // <-- use v1 auth service
const HttpError = require('../../../utils/HttpError');

/**
 * @desc Authenticate user (login) for web clients.
 * @route POST /api/v2/auth/login
 */
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Re-use v1 auth service to validate credentials & issue JWT
    const result = await authService.login(email, password);
    // result shape from v1: { token, userId, role, name, isNewUser?, message? }

    if (!result || !result.token) {
      throw new HttpError(401, 'Invalid email or password.');
    }

    // Return a consistent payload expected by the frontend
    return res.status(200).json({
      token: result.token,
      user: result.user || {
        id: result.userId,
        name: result.name,
        email: result.email || email,
        role: result.role,
        status: result.status,
        branchScope: result.branchScope,
        allowedBranches: result.allowedBranches || [],
        permissions: result.permissions || [],
        permissionOverrides: result.permissionOverrides || { add: [], remove: [] },
        effectivePermissions: result.effectivePermissions || [],
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { login };
