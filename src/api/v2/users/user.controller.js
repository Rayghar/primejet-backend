// src/api/v2/users/user.controller.js
const userService = require('./user.service'); // Should point to v2 service now (which re-exports v1 functions)
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');
const Plant = require('../../../models/plant.model');

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


const normalizeBranchOption = (row, source) => {
  if (!row) return null;
  const mongoId = String(row._id || row.mongoId || '').trim();
  const businessId = String(row.id || row.branchId || row.plantId || '').trim();
  const name = String(row.name || row.branchName || row.label || businessId || mongoId || '').trim();
  if (!mongoId && !businessId && !name) return null;
  // Use Mongo _id as the primary option value because DailySummary stores Plant._id.
  // Preserve the business id/code as branchCode so legacy StockIn/Expense/price records still match.
  const optionValue = mongoId || businessId || name;
  const stateOrLocation = source === 'service_zone'
    ? row.state
    : (row.location?.address || row.address || '');

  return {
    id: optionValue,
    _id: mongoId || undefined,
    mongoId: mongoId || undefined,
    branchId: optionValue,
    branchCode: String(row.branchCode || row.code || businessId || optionValue).trim(),
    branchKey: String(row.branchKey || row.key || mongoId || businessId || optionValue).trim(),
    branchName: name || businessId || optionValue,
    name: name || businessId || optionValue,
    label: stateOrLocation ? `${name || businessId || optionValue} (${stateOrLocation})` : (name || businessId || optionValue),
    source,
    status: row.status || (typeof row.isActive === 'boolean' ? (row.isActive ? 'Active' : 'Inactive') : undefined),
  };
};

const uniqueBranchOptions = (rows) => {
  const seen = new Set();
  return rows.filter(Boolean).filter((row) => {
    const key = String(row.branchId || row.id || row.branchName || row.name || '').toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => String(a.branchName || a.name).localeCompare(String(b.branchName || b.name)));
};

// Returns Operations branch/plant options that can be assigned to Staff Access.
// Important: this intentionally uses Plant records only. Service zones are delivery
// areas, not cashier/finance operating branches, and assigning staff to a zone can
// cause POS, Close Workspace and Finance filters to miss the actual branch.
const adminGetBranchOptions = async (req, res, next) => {
  try {
    const plants = await Plant.find({}).select('_id id name branchCode branchKey code key location status').lean();
    const options = uniqueBranchOptions(plants.map((row) => normalizeBranchOption(row, 'plant')));
    res.status(200).json({ branches: options, count: options.length, source: 'operations.plants' });
  } catch (error) {
    logger.error('Error in adminGetBranchOptions (v2):', error);
    next(new HttpError(500, 'Failed to fetch branch options.'));
  }
};

// Creates a new user. Mirrors v1/users/admin route but returns a simplified payload.
const adminCreateUser = async (req, res, next) => {
  try {
    const newUser = await userService.adminCreateUser(req.body);
    res.status(201).json({ id: newUser.id, user: newUser, message: 'User created successfully.' });
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
  adminGetBranchOptions,
  adminCreateUser,
  adminGetUser,
  adminUpdateUserRole,
  adminUpdateUser,
  deleteUserById,
  getDriverStats,
};