// src/api/financialService.js
import httpClient from "./httpClient";

/**
 * Financial Service (v2) - GL-first reporting
 *
 * IMPORTANT:
 * - /api/v2/financials/statements should return GL-based statements (audit-grade)
 *
 * Supported usage:
 *  - getFinancialStatements(period, startDate, endDate, branchIdOrZoneId)            (legacy signature)
 *  - getFinancialStatements({ period, startDate, endDate, branchIdOrZoneId })       (new signature)
 *  - getFinancialStatements({ startDate, endDate, branchIdOrZoneId })               (auto custom)
 */

// -------------------------
// tiny helpers
// -------------------------
const hasVal = (v) => v !== undefined && v !== null && String(v).trim() !== "";
const safeObj = (v) => (v && typeof v === "object" ? v : {});
const toNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

// backend treats branchId == serviceZoneId (send both for safety)
const buildBranchParams = (branchIdOrZoneId) => {
  if (!hasVal(branchIdOrZoneId)) return {};
  return { branchId: branchIdOrZoneId, serviceZoneId: branchIdOrZoneId };
};

// Build period params (backend supports monthly|quarterly|yearly|custom)
const buildPeriodParams = (period = "monthly", startDate, endDate) => {
  const params = { period: period || "monthly" };

  // if explicit custom range is provided, enforce custom
  if (hasVal(startDate) && hasVal(endDate)) {
    params.period = "custom";
    params.startDate = startDate;
    params.endDate = endDate;
  }

  return params;
};

// Safe GET wrapper (consistent error surface)
const normalizeApiError = (err, fallback = "Request failed") => {
  const status = err?.response?.status;
  const serverMsg = err?.response?.data?.message || err?.response?.data?.error || err?.response?.data?.msg;
  const msg = serverMsg || err?.message || fallback;

  const e = new Error(msg);
  e.status = status;
  e.raw = err;
  throw e;
};

const safeGet = async (url, params, fallbackMsg) => {
  try {
    const res = await httpClient.get(url, { params });
    return res.data;
  } catch (err) {
    normalizeApiError(err, fallbackMsg);
  }
};

// -------------------------
// Statements (GL-first)
// -------------------------
export const getFinancialStatements = async (...args) => {
  let period = "monthly";
  let startDate;
  let endDate;
  let branchIdOrZoneId;

  // new signature: ({ period, startDate, endDate, branchIdOrZoneId })
  if (args.length === 1 && args[0] && typeof args[0] === "object") {
    const o = args[0];
    period = o.period || "monthly";
    startDate = o.startDate;
    endDate = o.endDate;

    // tolerate alternative keys
    branchIdOrZoneId = o.branchIdOrZoneId || o.branchId || o.serviceZoneId;

    // If user gave a custom range but didn't specify period, force custom
    if (!hasVal(o.period) && hasVal(startDate) && hasVal(endDate)) period = "custom";
  } else {
    // legacy signature: (period, startDate, endDate, branchIdOrZoneId)
    [period, startDate, endDate, branchIdOrZoneId] = args;
    if (!hasVal(period)) period = "monthly";
    if (hasVal(startDate) && hasVal(endDate)) period = "custom";
  }

  const params = {
    ...buildPeriodParams(period, startDate, endDate),
    ...buildBranchParams(branchIdOrZoneId),
  };

  const payload = safeObj(await safeGet("/financials/statements", params, "Failed to load financial statements"));

  // Return payload unchanged + safe mirrors + normalized key metrics
  const income = safeObj(payload.income);
  const balance = safeObj(payload.balance);
  const ratios = safeObj(payload.ratios);
  const periodObj = safeObj(payload.period);
  const branchObj = safeObj(payload.branch);
  const gl = safeObj(payload.gl);

  return {
    ...payload,
    income,
    balance,
    ratios,
    period: periodObj,
    branch: branchObj,
    gl, // optional: GL_ONLY / enabled / mode flags if backend returns them
    _normalized: {
      revenueTotal: toNum(income?.revenue?.total, 0),
      deliveryRecognized: toNum(income?.revenue?.delivery, 0),
      posRevenue: toNum(income?.revenue?.pos, 0),
      cogsTotal: toNum(income?.cogs?.total, 0),
      opexTotal: toNum(income?.expenses?.total, 0),
      ebitda: toNum(income?.ebitda, 0),
      netIncome: toNum(income?.netIncome, 0),
    },
  };
};

// -------------------------
// Reports (legacy screens)
// -------------------------
export const getRevenueAssuranceReport = async (branchIdOrZoneId) => {
  const params = buildBranchParams(branchIdOrZoneId);
  return safeGet("/financials/revenue-assurance", params, "Failed to load revenue assurance report");
};

export const getTaxComplianceReport = async (branchIdOrZoneId) => {
  const params = buildBranchParams(branchIdOrZoneId);
  return safeGet("/financials/tax-compliance", params, "Failed to load tax compliance report");
};

export const getCashMovementReport = async ({ period = 'custom', startDate, endDate, branchIdOrZoneId } = {}) => {
  const params = { ...buildPeriodParams(period, startDate, endDate), ...buildBranchParams(branchIdOrZoneId) };
  return safeGet('/financials/cash-movement', params, 'Failed to load cash movement report');
};

export const getExpenseAnalysisReport = async ({ period = 'custom', startDate, endDate, branchIdOrZoneId } = {}) => {
  const params = { ...buildPeriodParams(period, startDate, endDate), ...buildBranchParams(branchIdOrZoneId) };
  return safeGet('/financials/expense-analysis', params, 'Failed to load expense analysis report');
};

export const financialExportUrl = ({ type = 'cash-movement', period = 'custom', startDate, endDate, branchIdOrZoneId } = {}) => {
  const params = new URLSearchParams({ type, ...buildPeriodParams(period, startDate, endDate), ...buildBranchParams(branchIdOrZoneId) });
  return `/api/v2/financials/export?${params.toString()}`;
};


// -------------------------
// Wave 11A: Optional Settlement & Revenue Assurance Controls
// -------------------------
export const getSettlementDashboard = async ({
  period = 'custom',
  startDate,
  endDate,
  branchIdOrZoneId,
  status,
  limit = 250,
} = {}) => {
  const params = {
    ...buildPeriodParams(period, startDate, endDate),
    ...buildBranchParams(branchIdOrZoneId),
    limit,
  };
  if (hasVal(status)) params.status = status;
  return safeGet('/financials/settlement-dashboard', params, 'Failed to load settlement dashboard');
};

export const getSettlementConfirmations = async ({
  period = 'custom',
  startDate,
  endDate,
  branchIdOrZoneId,
  status,
  limit = 250,
} = {}) => {
  const params = {
    ...buildPeriodParams(period, startDate, endDate),
    ...buildBranchParams(branchIdOrZoneId),
    limit,
  };
  if (hasVal(status)) params.status = status;
  return safeGet('/financials/settlements', params, 'Failed to load settlement confirmations');
};

export const confirmSettlement = async ({
  dailySummaryId,
  settlementType,
  actualAmount,
  reference,
  narration,
  terminalOrChannel,
  notes,
  varianceReason,
  status,
  businessDate,
  branchId,
} = {}) => {
  try {
    const res = await httpClient.post('/financials/settlements/confirm', {
      dailySummaryId,
      settlementType,
      actualAmount,
      reference,
      narration,
      terminalOrChannel,
      notes,
      varianceReason,
      status,
      businessDate,
      branchId,
    });
    return res.data;
  } catch (err) {
    normalizeApiError(err, 'Failed to save settlement confirmation');
  }
};

export const uploadManualStatementRows = async ({
  sourceType = 'BANK',
  uploadName,
  branchId,
  periodStart,
  periodEnd,
  rawText,
  rows,
  meta,
} = {}) => {
  try {
    const res = await httpClient.post('/financials/statement-uploads', {
      sourceType,
      uploadName,
      branchId,
      periodStart,
      periodEnd,
      rawText,
      rows,
      meta,
    });
    return res.data;
  } catch (err) {
    normalizeApiError(err, 'Failed to upload statement rows');
  }
};

export const getStatementUploads = async ({ branchIdOrZoneId, sourceType, limit = 50 } = {}) => {
  const params = { ...buildBranchParams(branchIdOrZoneId), limit };
  if (hasVal(sourceType)) params.sourceType = sourceType;
  return safeGet('/financials/statement-uploads', params, 'Failed to load statement uploads');
};

export const getRevenueLeakageDashboard = async ({
  period = 'custom',
  startDate,
  endDate,
  branchIdOrZoneId,
} = {}) => {
  const params = { ...buildPeriodParams(period, startDate, endDate), ...buildBranchParams(branchIdOrZoneId) };
  return safeGet('/financials/revenue-leakage', params, 'Failed to load revenue leakage dashboard');
};

export const settlementExportUrl = ({
  period = 'custom',
  startDate,
  endDate,
  branchIdOrZoneId,
} = {}) => {
  const params = new URLSearchParams({
    ...buildPeriodParams(period, startDate, endDate),
    ...buildBranchParams(branchIdOrZoneId),
  });
  return `/api/v2/financials/settlements/export?${params.toString()}`;
};
