// src/utils/branchIdentity.js
const mongoose = require('mongoose');

const hasVal = (value) => value !== undefined && value !== null && String(value).trim() !== '';
const normalizeBranchKey = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/&/g, 'and')
  .replace(/[^a-z0-9]/g, '');

const splitBranchValues = (value) => {
  if (Array.isArray(value)) return value.flatMap(splitBranchValues);
  if (!hasVal(value)) return [];
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
};

const uniq = (values = []) => [...new Set(values.filter(hasVal).map((value) => String(value).trim()))];

const branchAliasesFromRecord = (branch = {}) => {
  if (typeof branch === 'string') return splitBranchValues(branch);
  return uniq([
    branch.branchId,
    branch.branchCode,
    branch.branchKey,
    branch.id,
    branch._id,
    branch.mongoId,
    branch.plantId,
    branch.plantCode,
    branch.code,
    branch.key,
    branch.name,
    branch.branchName,
    branch.label,
  ]);
};

const plantAliases = (plant = {}) => uniq([
  plant._id ? String(plant._id) : null,
  plant.id,
  plant.name,
  plant.branchCode,
  plant.branchKey,
  plant.code,
  plant.key,
]);

const buildBranchOrZoneMatch = (branchIdOrZoneId) => {
  const values = uniq(splitBranchValues(branchIdOrZoneId));
  if (!values.length) return {};
  const ors = [];
  for (const value of values) {
    const s = String(value);
    const oid = mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : null;
    ors.push(
      { branchId: s },
      { branchCode: s },
      { branchKey: s },
      { plantId: s },
      { serviceZoneId: s },
      { zoneId: s }
    );
    if (oid) {
      ors.push({ branchId: oid }, { plantId: oid }, { serviceZoneId: oid }, { zoneId: oid });
    }
  }
  return { $or: ors };
};

module.exports = {
  hasVal,
  normalizeBranchKey,
  splitBranchValues,
  uniq,
  branchAliasesFromRecord,
  plantAliases,
  buildBranchOrZoneMatch,
};
