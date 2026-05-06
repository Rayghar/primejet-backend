// src/middleware/permission.middleware.js
const HttpError = require('../utils/HttpError');
const { hasPermission, hasAnyPermission, getEffectivePermissions } = require('../config/rolePermissions');

const attachEffectivePermissions = (req, _res, next) => {
  if (req.user) {
    req.user.effectivePermissions = getEffectivePermissions(req.user);
  }
  next();
};

const requirePermission = (permission) => (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'Authentication required.'));
  if (!hasPermission(req.user, permission)) {
    return next(new HttpError(403, `Missing required permission: ${permission}`));
  }
  next();
};

const requireAnyPermission = (permissions = []) => (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'Authentication required.'));
  if (!hasAnyPermission(req.user, permissions)) {
    return next(new HttpError(403, `Missing required permission. Required one of: ${permissions.join(', ')}`));
  }
  next();
};

module.exports = { attachEffectivePermissions, requirePermission, requireAnyPermission };
