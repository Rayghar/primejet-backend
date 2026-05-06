// src/middleware/branchScope.middleware.js
const mongoose = require('mongoose');
const HttpError = require('../utils/HttpError');
const branchIdentity = require('../utils/branchIdentity');

let Plant = null;
try {
  Plant = require('../models/plant.model');
} catch (_) {
  Plant = null;
}

const hasVal = (value) => value !== undefined && value !== null && String(value).trim() !== '';
const normalize = branchIdentity.normalizeBranchKey;

const splitValues = branchIdentity.splitBranchValues;
const uniq = branchIdentity.uniq;

const rawBranchAliases = branchIdentity.branchAliasesFromRecord;

const getAllowedBranchEntries = (user = {}) => {
  const allowedBranches = Array.isArray(user.allowedBranches) ? user.allowedBranches : [];
  return allowedBranches
    .map((branch) => {
      const aliases = rawBranchAliases(branch);
      const keys = aliases.map(normalize).filter(Boolean);
      if (!keys.length) return null;
      return { source: branch, aliases, keys };
    })
    .filter(Boolean);
};

const plantAliases = branchIdentity.plantAliases;

const resolveAllowedBranchEntries = async (user = {}) => {
  const entries = getAllowedBranchEntries(user);
  if (!entries.length || !Plant) return entries;

  const allAliases = uniq(entries.flatMap((entry) => entry.aliases));
  const ors = [];
  for (const alias of allAliases) {
    ors.push({ id: alias }, { name: alias }, { branchCode: alias }, { branchKey: alias }, { code: alias }, { key: alias });
    if (mongoose.Types.ObjectId.isValid(alias)) ors.push({ _id: new mongoose.Types.ObjectId(alias) });
  }

  if (!ors.length) return entries;

  let plants = [];
  try {
    plants = await Plant.find({ $or: ors }).select('_id id name branchCode branchKey code key').lean();
  } catch (_) {
    plants = [];
  }

  return entries.map((entry) => {
    const matchedPlants = plants.filter((plant) => {
      const pKeys = plantAliases(plant).map(normalize).filter(Boolean);
      return entry.keys.some((key) => pKeys.includes(key));
    });
    const aliases = uniq([
      ...entry.aliases,
      ...matchedPlants.flatMap(plantAliases),
    ]);
    return {
      ...entry,
      aliases,
      keys: aliases.map(normalize).filter(Boolean),
      plants: matchedPlants,
    };
  });
};

const getAllowedBranchKeys = (user = {}) => getAllowedBranchEntries(user)
  .flatMap((entry) => entry.keys)
  .filter(Boolean);

const getAllowedBranchAliases = (user = {}) => getAllowedBranchEntries(user)
  .flatMap((entry) => entry.aliases)
  .filter(Boolean);

const getRequestedBranchValues = (req) => {
  const source = {
    ...(req.params || {}),
    ...(req.query || {}),
    ...(req.body || {}),
  };
  return uniq([
    ...splitValues(source.branchId),
    ...splitValues(source.branchIdOrZoneId),
    ...splitValues(source.branchCode),
    ...splitValues(source.branchKey),
    ...splitValues(source.plantId),
    ...splitValues(source.plantCode),
    ...splitValues(source.serviceZoneId),
    ...splitValues(source.zoneId),
  ]);
};

const getRequestedBranchKey = (req) => {
  const values = getRequestedBranchValues(req);
  return normalize(values[0] || '');
};

const isBranchAllowed = (user = {}, requestedBranchValue) => {
  const requestedValues = splitValues(requestedBranchValue);
  if (!requestedValues.length) return true;
  if (user.branchScope === 'all' || user.role === 'admin' || user.role === 'super_admin') return true;
  if (user.branchScope === 'none') return false;

  const allowedKeys = getAllowedBranchKeys(user);
  if (!allowedKeys.length) return false;

  return requestedValues.every((value) => {
    const requestedKey = normalize(value);
    if (!requestedKey) return true;
    return allowedKeys.some((allowedKey) => {
      if (allowedKey === requestedKey) return true;
      // Tolerant matching covers user-entered names such as "Festac" versus
      // branch records such as "Festac Plant". Exact IDs still match first.
      if (allowedKey.length >= 4 && requestedKey.includes(allowedKey)) return true;
      if (requestedKey.length >= 4 && allowedKey.includes(requestedKey)) return true;
      return false;
    });
  });
};

const requireBranchScope = (options = {}) => async (req, _res, next) => {
  try {
    if (!req.user) return next(new HttpError(401, 'Authentication required.'));

    const scopedRoles = Array.isArray(options.roles) ? options.roles : null;
    const roleRequiresExplicitBranch = !scopedRoles || scopedRoles.includes(req.user.role);
    const requestedValues = getRequestedBranchValues(req);

    if (req.user.branchScope === 'selected' && roleRequiresExplicitBranch) {
      const entries = await resolveAllowedBranchEntries(req.user);
      const aliases = uniq(entries.flatMap((entry) => entry.aliases));
      const keys = aliases.map(normalize).filter(Boolean);

      req.branchScopeFilter = {
        restricted: true,
        scope: 'selected',
        allowedBranches: entries,
        aliases,
        keys,
      };

      if (!aliases.length) {
        return next(new HttpError(403, 'No branch or plant has been assigned to this user.'));
      }

      if (!requestedValues.length && options.requireBranchForSelected) {
        // Important: inject ALL aliases for the assigned branch(es), not just the
        // first normalized display key. This prevents selected-scope investors
        // from leaking into all branches while still matching mixed schemas:
        // DailySummary.branchId(ObjectId), StockIn.branchId(string), legacy id/name.
        const scopedValue = aliases.join(',');
        req.query = req.query || {};
        req.query.branchId = req.query.branchId || scopedValue;
        req.query.serviceZoneId = req.query.serviceZoneId || scopedValue;
        return next();
      }

      const unauthorized = requestedValues.some((value) => !keys.some((allowedKey) => {
        const requestedKey = normalize(value);
        if (!requestedKey) return false;
        if (allowedKey === requestedKey) return true;
        if (allowedKey.length >= 4 && requestedKey.includes(allowedKey)) return true;
        if (requestedKey.length >= 4 && allowedKey.includes(requestedKey)) return true;
        return false;
      }));

      if (unauthorized) return next(new HttpError(403, 'You are not authorized to access this branch or plant.'));
    } else if (requestedValues.length && !requestedValues.every((value) => isBranchAllowed(req.user, value))) {
      return next(new HttpError(403, 'You are not authorized to access this branch or plant.'));
    }

    return next();
  } catch (error) {
    return next(error);
  }
};

const applyBranchScopeToQuery = (query = {}, user = {}) => {
  if (!user || user.branchScope === 'all' || user.role === 'admin' || user.role === 'super_admin') return query;
  const allowedAliases = getAllowedBranchAliases(user);
  if (allowedAliases.length === 0) return { ...query, branchKey: '__NO_BRANCH_ACCESS__' };
  return {
    ...query,
    $or: [
      { branchId: { $in: allowedAliases } },
      { branchCode: { $in: allowedAliases } },
      { branchKey: { $in: allowedAliases } },
      { plantId: { $in: allowedAliases } },
      { serviceZoneId: { $in: allowedAliases } },
      { zoneId: { $in: allowedAliases } },
    ],
  };
};

module.exports = {
  requireBranchScope,
  isBranchAllowed,
  getAllowedBranchKeys,
  getAllowedBranchAliases,
  getRequestedBranchKey,
  getRequestedBranchValues,
  applyBranchScopeToQuery,
};
