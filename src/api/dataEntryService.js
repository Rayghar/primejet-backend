// src/api/dataEntryService.js
import httpClient from "./httpClient";
import { glPostApproved, glRetryFailed, glPostingExceptions } from "./glService";

/**
 * Data Entry Service (GL-aligned)
 *
 * IMPORTANT:
 * - httpClient baseURL ALREADY includes:  <API_URL>/api/v2
 * - Therefore: DO NOT prefix "/api/v2" in the paths below,
 *   or you will get: /api/v2/api/v2/... (404)
 *
 * Goals:
 * - Keep existing /data-entry routes intact (legacy-compatible)
 * - Add Daily Summary helpers required by DailyLog + CloseWorkspace
 * - Add GL-first helpers used by Close Workspace UI (delegates posting to GL service)
 *
 * Backend alias routes expected (full paths shown for clarity):
 *   POST   /api/v2/data-entry/daily-summary/get-or-create
 *   GET    /api/v2/data-entry/daily-summary/entries?summaryId=...
 *   PATCH  /api/v2/data-entry/daily-summary/:summaryId/meters
 *   POST   /api/v2/data-entry/daily-summary/:summaryId/sales
 *   POST   /api/v2/data-entry/daily-summary/:summaryId/expenses
 *   POST   /api/v2/data-entry/daily-summary/:summaryId/finalize
 *   GET    /api/v2/data-entry/transactions/history
 *
 * In this client file (because baseURL already includes /api/v2),
 * we call them as:
 *   /data-entry/...
 */

const hasVal = (v) => v !== undefined && v !== null && String(v).trim() !== "";

const normalizeBranchParams = (branchIdOrZoneId) => {
  if (!hasVal(branchIdOrZoneId)) return {};
  // backend treats branchId and serviceZoneId interchangeably
  return { branchId: branchIdOrZoneId, serviceZoneId: branchIdOrZoneId };
};

const splitSummaryArgs = (arg, payload = {}) => {
  if (typeof arg === "string" || typeof arg === "number") return { summaryId: String(arg), payload: payload || {} };
  const input = arg || {};
  return { summaryId: input.summaryId || input.dailySummaryId || input._id, payload: input };
};

// -------------------- existing API wrappers --------------------

export const getDataEntries = async (filters = {}, options = {}) => {
  const { data } = await httpClient.get("/data-entry", { params: filters, ...options });
  return data;
};

export const createDataEntry = async (payload, options = {}) => {
  const { data } = await httpClient.post("/data-entry", payload, options);
  return data;
};

export const updateDataEntry = async (id, payload, options = {}) => {
  const { data } = await httpClient.patch(`/data-entry/${id}`, payload, options);
  return data;
};

export const submitDataEntry = async (id, options = {}) => {
  const { data } = await httpClient.post(`/data-entry/${id}/submit`, {}, options);
  return data;
};

export const approveDataEntry = async (id, options = {}) => {
  const { data } = await httpClient.post(`/data-entry/${id}/approve`, {}, options);
  return data;
};

export const rejectDataEntry = async (id, payload, options = {}) => {
  const { data } = await httpClient.post(`/data-entry/${id}/reject`, payload, options);
  return data;
};

// -------------------- GL-first helpers --------------------

/**
 * Post all approved operational docs for a business date + branch.
 * Used by Close Workspace "Post Approved".
 */
export const postApprovedToGLForDay = async ({ businessDate, branchIdOrZoneId } = {}) => {
  if (!hasVal(businessDate)) {
    throw new Error("postApprovedToGLForDay: businessDate is required (YYYY-MM-DD)");
  }
  return glPostApproved({ businessDate, branchIdOrZoneId });
};

/**
 * Retry failed postings in a date range.
 */
export const retryFailedPostings = async ({ startDate, endDate, branchIdOrZoneId } = {}) => {
  if (!hasVal(startDate) || !hasVal(endDate)) {
    throw new Error("retryFailedPostings: startDate and endDate are required (YYYY-MM-DD)");
  }
  return glRetryFailed({ startDate, endDate, branchIdOrZoneId });
};

/**
 * Fetch posting exceptions grouped by reason.
 */
export const getPostingExceptions = async ({ startDate, endDate, branchIdOrZoneId } = {}) => {
  if (!hasVal(startDate) || !hasVal(endDate)) {
    throw new Error("getPostingExceptions: startDate and endDate are required (YYYY-MM-DD)");
  }
  return glPostingExceptions({ startDate, endDate, branchIdOrZoneId });
};

// -------------------- Daily Summary helpers (required by DailyLog + CloseWorkspace) --------------------

/**
 * Create or fetch the Daily Summary for a branch + date.
 * Payload expected by backend: { branchId, date, cashierName, pricePerKg }
 */
export const createOrGetDailySummary = async (payload, options = {}) => {
  const { data } = await httpClient.post("/data-entry/daily-summary/get-or-create", payload, options);
  return data;
};

/**
 * Fetch entries and summary rollups.
 * Uses alias endpoint: /daily-summary/entries?summaryId=...
 */
export const getDailyEntries = async (arg = {}, options = {}) => {
  const { summaryId, payload } = splitSummaryArgs(arg);
  if (!hasVal(summaryId)) throw new Error("getDailyEntries: summaryId is required");
  const { data } = await httpClient.get("/data-entry/daily-summary/entries", {
    params: { summaryId, ...payload },
    ...options,
  });
  return data;
};

/**
 * Update opening/closing meters.
 * PATCH /daily-summary/:summaryId/meters
 */
export const updateSummaryMeters = async (arg = {}, payloadOrOptions = {}, maybeOptions = {}) => {
  const positional = typeof arg === "string" || typeof arg === "number";
  const { summaryId, payload } = positional ? splitSummaryArgs(arg, payloadOrOptions) : splitSummaryArgs(arg);
  const options = positional ? maybeOptions : payloadOrOptions;
  if (!hasVal(summaryId)) throw new Error("updateSummaryMeters: summaryId is required");
  const cleanPayload = { ...payload };
  delete cleanPayload.summaryId; delete cleanPayload.dailySummaryId; delete cleanPayload._id;
  const { data } = await httpClient.patch(`/data-entry/daily-summary/${summaryId}/meters`, cleanPayload, options);
  return data;
};

/**
 * Log a sale entry into the daily summary.
 * POST /daily-summary/:summaryId/sales
 */
export const logSale = async (arg = {}, payloadOrOptions = {}, maybeOptions = {}) => {
  const positional = typeof arg === "string" || typeof arg === "number";
  const { summaryId, payload } = positional ? splitSummaryArgs(arg, payloadOrOptions) : splitSummaryArgs(arg);
  const options = positional ? maybeOptions : payloadOrOptions;
  if (!hasVal(summaryId)) throw new Error("logSale: summaryId is required");
  const cleanPayload = { ...payload };
  delete cleanPayload.summaryId; delete cleanPayload.dailySummaryId; delete cleanPayload._id;
  const { data } = await httpClient.post(`/data-entry/daily-summary/${summaryId}/sales`, cleanPayload, options);
  return data;
};

/**
 * Log an expense entry into the daily summary.
 * POST /daily-summary/:summaryId/expenses
 */
export const logExpense = async (arg = {}, payloadOrOptions = {}, maybeOptions = {}) => {
  const positional = typeof arg === "string" || typeof arg === "number";
  const { summaryId, payload } = positional ? splitSummaryArgs(arg, payloadOrOptions) : splitSummaryArgs(arg);
  const options = positional ? maybeOptions : payloadOrOptions;
  if (!hasVal(summaryId)) throw new Error("logExpense: summaryId is required");
  const cleanPayload = { ...payload };
  delete cleanPayload.summaryId; delete cleanPayload.dailySummaryId; delete cleanPayload._id;
  const { data } = await httpClient.post(`/data-entry/daily-summary/${summaryId}/expenses`, cleanPayload, options);
  return data;
};

/**
 * Finalize/submit the summary (locks totals and moves status forward server-side).
 * POST /daily-summary/:summaryId/finalize
 */
export const finalizeDailySummary = async (arg = {}, payloadOrOptions = {}, maybeOptions = {}) => {
  const positional = typeof arg === "string" || typeof arg === "number";
  const { summaryId, payload } = positional ? splitSummaryArgs(arg, payloadOrOptions) : splitSummaryArgs(arg);
  const options = positional ? maybeOptions : payloadOrOptions;
  if (!hasVal(summaryId)) throw new Error("finalizeDailySummary: summaryId is required");
  const cleanPayload = { ...payload };
  delete cleanPayload.summaryId; delete cleanPayload.dailySummaryId; delete cleanPayload._id;
  const { data } = await httpClient.post(`/data-entry/daily-summary/${summaryId}/finalize`, cleanPayload, options);
  return data;
};

// -------------------- Approval Queue compatibility --------------------

/**
 * For ApprovalQueue UI.
 * Uses existing list endpoint with status filter.
 */
export const getPendingApprovals = async (filters = {}, options = {}) => {
  const params = { ...filters, ...normalizeBranchParams(filters.branchIdOrZoneId) };
  delete params.branchIdOrZoneId;
  const { data } = await httpClient.get("/data-entry/daily-summary/pending-approval", { params, ...options });
  return data;
};

export const getApprovalHistory = async (filters = {}, options = {}) => {
  const params = { ...filters, ...normalizeBranchParams(filters.branchIdOrZoneId) };
  delete params.branchIdOrZoneId;
  const { data } = await httpClient.get("/data-entry/daily-summary/history", { params, ...options });
  return data;
};

export const approveSummary = async (id, payload = {}, options = {}) => {
  if (!hasVal(id)) throw new Error("approveSummary: summaryId is required");
  const cleanPayload = payload && typeof payload === 'object' && !('signal' in payload) ? payload : {};
  const cleanOptions = payload && typeof payload === 'object' && 'signal' in payload ? payload : options;
  const { data } = await httpClient.put(`/data-entry/daily-summary/${id}/approve`, cleanPayload, cleanOptions);
  return data;
};

export const rejectSummary = async (id, payload = {}, options = {}) => {
  if (!hasVal(id)) throw new Error("rejectSummary: summaryId is required");
  const { data } = await httpClient.put(`/data-entry/daily-summary/${id}/reject`, payload, options);
  return data;
};

export const reopenSummary = async (id, payload = {}, options = {}) => {
  if (!hasVal(id)) throw new Error("reopenSummary: summaryId is required");
  const { data } = await httpClient.post(`/data-entry/daily-summary/${id}/reopen`, payload, options);
  return data;
};

export const getReceiptHistory = async (summaryId, options = {}) => {
  if (!hasVal(summaryId)) throw new Error("getReceiptHistory: summaryId is required");
  const { data } = await httpClient.get(`/data-entry/daily-summary/${summaryId}/receipts`, options);
  return data;
};

// -------------------- Transaction history --------------------

export const getTransactionHistory = async (params = {}, options = {}) => {
  const merged = { ...params, ...normalizeBranchParams(params.branchIdOrZoneId) };
  delete merged.branchIdOrZoneId;

  const { data } = await httpClient.get("/data-entry/transactions/history", {
    params: merged,
    ...options,
  });
  return data;
};
// -------------------- Daily close control helpers --------------------
export const getOpenDailySummaries = async (filters = {}, options = {}) => {
  const params = { ...filters, ...normalizeBranchParams(filters.branchIdOrZoneId) };
  delete params.branchIdOrZoneId;
  const { data } = await httpClient.get('/data-entry/daily-summary/open-days', { params, ...options });
  return Array.isArray(data) ? data : (data?.items || []);
};


export const getDailyCloseDashboard = async (filters = {}, options = {}) => {
  const params = { ...filters, ...normalizeBranchParams(filters.branchIdOrZoneId) };
  delete params.branchIdOrZoneId;
  const { data } = await httpClient.get('/data-entry/daily-close/dashboard', { params, ...options });
  return data;
};

export const voidSaleEntry = async ({ summaryId, saleId, reason } = {}, options = {}) => {
  if (!hasVal(summaryId)) throw new Error('summaryId is required');
  if (!hasVal(saleId)) throw new Error('saleId is required');
  if (!hasVal(reason)) throw new Error('reason is required');
  const { data } = await httpClient.post(`/data-entry/daily-summary/${summaryId}/sales/${saleId}/void`, { reason }, options);
  return data;
};

export const voidExpenseEntry = async ({ summaryId, expenseId, reason } = {}, options = {}) => {
  if (!hasVal(summaryId)) throw new Error('summaryId is required');
  if (!hasVal(expenseId)) throw new Error('expenseId is required');
  if (!hasVal(reason)) throw new Error('reason is required');
  const { data } = await httpClient.post(`/data-entry/daily-summary/${summaryId}/expenses/${expenseId}/void`, { reason }, options);
  return data;
};
