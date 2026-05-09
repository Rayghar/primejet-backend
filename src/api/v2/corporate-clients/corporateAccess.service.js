// File: src/api/v2/corporate-clients/corporateAccess.service.js
// Branch-scope helpers for corporate account, request, fulfilment and billing views.
// Non-breaking: super_admin/admin and users with branchScope=all see all rows.

const HttpError = require('../../../utils/HttpError');

const privilegedRoles = new Set(['super_admin', 'admin']);
const clean = (v) => (v === undefined || v === null ? '' : String(v).trim());

const userCanSeeAllBranches = (user = {}) => {
  if (privilegedRoles.has(clean(user.role))) return true;
  if (!user.branchScope || user.branchScope === 'all') return true;
  return false;
};

const getAllowedBranchTokens = (user = {}) => {
  if (userCanSeeAllBranches(user)) return [];
  if (user.branchScope === 'none') return ['__NO_BRANCH_ACCESS__'];
  const tokens = new Set();
  (Array.isArray(user.allowedBranches) ? user.allowedBranches : []).forEach((b) => {
    [b.branchId, b.branchKey, b.branchCode, b.branchName].forEach((x) => {
      const s = clean(x);
      if (s) tokens.add(s);
    });
  });
  return Array.from(tokens);
};

const branchFilterForField = (user = {}, field = 'assignedBranchId') => {
  if (userCanSeeAllBranches(user)) return {};
  const tokens = getAllowedBranchTokens(user);
  if (!tokens.length || tokens.includes('__NO_BRANCH_ACCESS__')) return { [field]: '__NO_BRANCH_ACCESS__' };
  return { [field]: { $in: tokens } };
};

const corporateClientBranchFilter = (user = {}) => {
  if (userCanSeeAllBranches(user)) return {};
  const tokens = getAllowedBranchTokens(user);
  if (!tokens.length || tokens.includes('__NO_BRANCH_ACCESS__')) return { assignedBranchId: '__NO_BRANCH_ACCESS__' };
  return {
    $or: [
      { assignedBranchId: { $in: tokens } },
      { assignedBranchName: { $in: tokens } },
    ],
  };
};

const corporateFulfilmentBranchFilter = (user = {}) => {
  if (userCanSeeAllBranches(user)) return {};
  const tokens = getAllowedBranchTokens(user);
  if (!tokens.length || tokens.includes('__NO_BRANCH_ACCESS__')) return { branchId: '__NO_BRANCH_ACCESS__' };
  return {
    $or: [
      { branchId: { $in: tokens } },
      { branchName: { $in: tokens } },
    ],
  };
};

const clientIdsForBranchScope = async (CorporateClientModel, user = {}) => {
  if (userCanSeeAllBranches(user)) return null;
  const clients = await CorporateClientModel.find(corporateClientBranchFilter(user)).select('id').lean();
  return clients.map((c) => c.id);
};

const assertClientAccess = (user = {}, client = {}) => {
  if (!client) throw new HttpError(404, 'Corporate client not found.');
  if (userCanSeeAllBranches(user)) return true;
  const tokens = new Set(getAllowedBranchTokens(user));
  const allowed = [client.assignedBranchId, client.assignedBranchName].some((x) => tokens.has(clean(x)));
  if (!allowed) throw new HttpError(403, 'You do not have access to this corporate client branch.');
  return true;
};

module.exports = {
  userCanSeeAllBranches,
  getAllowedBranchTokens,
  branchFilterForField,
  corporateClientBranchFilter,
  corporateFulfilmentBranchFilter,
  clientIdsForBranchScope,
  assertClientAccess,
};
