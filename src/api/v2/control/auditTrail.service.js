// src/api/v2/control/auditTrail.service.js
const DailyCloseAudit = require('../../../models/dailyCloseAudit.model');

const writeControlAudit = async ({ summary = null, branchId = null, businessDate = null, action, performedBy = 'system', reason = null, meta = {} }) => {
  try {
    return await DailyCloseAudit.create({
      dailySummaryId: summary?._id || null,
      dailySummaryPublicId: summary?.dailySummaryId || null,
      branchId: branchId || (summary?.branchId ? String(summary.branchId) : null),
      businessDate: businessDate || summary?.date || null,
      action,
      statusBefore: meta?.statusBefore || null,
      statusAfter: meta?.statusAfter || null,
      performedBy,
      reason,
      meta,
    });
  } catch (error) {
    return null;
  }
};

module.exports = { writeControlAudit };
