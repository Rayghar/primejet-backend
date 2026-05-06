// src/utils/reportingPolicy.js
const normalizeSourceMode = (value) => {
  const mode = String(value || 'auto').toLowerCase().trim();
  if (['gl', 'operational', 'auto'].includes(mode)) return mode;
  return 'auto';
};

const buildReportingPolicyMeta = ({ sourceMode, resolvedSourceMode, period, start, end, branchKey, glCompleteness, fallbackReason } = {}) => ({
  sourceMode: normalizeSourceMode(sourceMode),
  resolvedSourceMode: resolvedSourceMode || normalizeSourceMode(sourceMode),
  period: period || null,
  dateRange: {
    start: start || null,
    end: end || null,
    basis: 'business_date',
    note: 'Financial reporting is filtered by transaction business dates, not upload/import timestamps.',
  },
  branchScope: {
    branchId: branchKey || null,
    basis: branchKey ? 'selected_or_assigned_branch_aliases' : 'all_authorized_branches',
  },
  sourceOfTruth: {
    operational: 'DailySummary.date, Order.orderDate, ExpenseTransaction.date and StockIn.purchaseDate',
    gl: 'GeneralLedgerEntry.date for posted journals',
    auto: 'GL is used only when selected-period source completeness is clean; otherwise operational fallback is used.',
  },
  glCompleteness: glCompleteness || null,
  fallbackReason: fallbackReason || null,
});

module.exports = {
  normalizeSourceMode,
  buildReportingPolicyMeta,
};
