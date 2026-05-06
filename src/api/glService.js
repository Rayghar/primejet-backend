// src/api/glService.js
import httpClient from "./httpClient";

/**
 * GL Service (v2)
 * - Calls GL orchestrator endpoints (GL-first flow)
 * - These endpoints must exist in backend gl.routes.js + gl.controller.js
 *
 * Endpoints:
 * - POST /api/v2/gl/bootstrap
 * - POST /api/v2/gl/rebuild
 * - GET  /api/v2/gl/trial-balance
 * - POST /api/v2/gl/post-approved
 * - POST /api/v2/gl/retry-failed
 * - GET  /api/v2/gl/posting-exceptions
 * - GET  /api/v2/gl/health
 * - GET  /api/v2/gl/journals          (optional drill-down)
 * - POST /api/v2/gl/reverse           (optional)
 */

const hasVal = (v) => v !== undefined && v !== null && String(v).trim() !== "";

// backend treats branchId == serviceZoneId (we send both for safety)
const withBranchParams = (branchIdOrZoneId) => {
  if (!hasVal(branchIdOrZoneId)) return {};
  return { branchId: branchIdOrZoneId, serviceZoneId: branchIdOrZoneId };
};

const normalizeApiError = (err, fallback = "Request failed") => {
  const status = err?.response?.status;
  const serverMsg = err?.response?.data?.message || err?.response?.data?.error || err?.response?.data?.msg;
  const msg = serverMsg || err?.message || fallback;

  const e = new Error(msg);
  e.status = status;
  e.raw = err;
  throw e;
};

const requireRange = (startDate, endDate, label = "startDate and endDate are required") => {
  if (!hasVal(startDate) || !hasVal(endDate)) {
    const e = new Error(label);
    e.code = "MISSING_RANGE";
    throw e;
  }
};

// -------------------------
// COA / bootstrap
// -------------------------
export const glBootstrap = async () => {
  try {
    const res = await httpClient.post("/gl/bootstrap");
    return res.data;
  } catch (err) {
    normalizeApiError(err, "Failed to bootstrap GL");
  }
};

// -------------------------
// Rebuild / trial balance
// -------------------------
export const glRebuild = async ({ startDate, endDate, branchIdOrZoneId } = {}) => {
  try {
    requireRange(startDate, endDate);

    const params = {
      startDate,
      endDate,
      ...withBranchParams(branchIdOrZoneId),
    };

    const res = await httpClient.post("/gl/rebuild", {}, { params });
    return res.data;
  } catch (err) {
    normalizeApiError(err, "Failed to rebuild GL");
  }
};

export const glTrialBalance = async ({ startDate, endDate, branchIdOrZoneId } = {}) => {
  try {
    requireRange(startDate, endDate);

    const params = {
      startDate,
      endDate,
      ...withBranchParams(branchIdOrZoneId),
    };

    const res = await httpClient.get("/gl/trial-balance", { params });
    return res.data;
  } catch (err) {
    normalizeApiError(err, "Failed to load trial balance");
  }
};

// -------------------------
// Posting orchestration
// -------------------------
export const glPostApproved = async ({ businessDate, branchIdOrZoneId } = {}) => {
  try {
    if (!hasVal(businessDate)) throw new Error("businessDate is required");

    // backend expects businessDate; include legacy date as fallback
    const params = {
      businessDate,
      date: businessDate,
      ...withBranchParams(branchIdOrZoneId),
    };

    const res = await httpClient.post("/gl/post-approved", {}, { params });
    return res.data;
  } catch (err) {
    normalizeApiError(err, "Failed to post approved documents to GL");
  }
};

export const glRetryFailed = async ({ startDate, endDate, branchIdOrZoneId } = {}) => {
  try {
    requireRange(startDate, endDate);

    const params = {
      startDate,
      endDate,
      ...withBranchParams(branchIdOrZoneId),
    };

    const res = await httpClient.post("/gl/retry-failed", {}, { params });
    return res.data;
  } catch (err) {
    normalizeApiError(err, "Failed to retry failed postings");
  }
};

export const glPostingExceptions = async ({ startDate, endDate, branchIdOrZoneId } = {}) => {
  try {
    requireRange(startDate, endDate);

    const params = {
      startDate,
      endDate,
      ...withBranchParams(branchIdOrZoneId),
    };

    const res = await httpClient.get("/gl/posting-exceptions", { params });
    return res.data;
  } catch (err) {
    normalizeApiError(err, "Failed to load posting exceptions");
  }
};

// -------------------------
// Health
// -------------------------
export const glHealth = async ({ startDate, endDate, branchIdOrZoneId } = {}) => {
  try {
    const params = {
      ...(hasVal(startDate) ? { startDate } : {}),
      ...(hasVal(endDate) ? { endDate } : {}),
      ...withBranchParams(branchIdOrZoneId),
    };

    const res = await httpClient.get("/gl/health", { params });
    return res.data;
  } catch (err) {
    normalizeApiError(err, "Failed to load GL health");
  }
};



// -------------------------
// Posting readiness controls
// -------------------------
export const glReadiness = async ({ startDate, endDate, branchIdOrZoneId } = {}) => {
  try {
    const params = {
      ...(hasVal(startDate) ? { startDate } : {}),
      ...(hasVal(endDate) ? { endDate } : {}),
      ...withBranchParams(branchIdOrZoneId),
    };

    const res = await httpClient.get("/gl/readiness", { params });
    return res.data;
  } catch (err) {
    normalizeApiError(err, "Failed to load GL posting readiness");
  }
};

export const glRunSafeSetup = async ({ startDate, endDate, branchIdOrZoneId } = {}) => {
  try {
    const params = {
      ...(hasVal(startDate) ? { startDate } : {}),
      ...(hasVal(endDate) ? { endDate } : {}),
      ...withBranchParams(branchIdOrZoneId),
    };

    const res = await httpClient.post("/gl/readiness/run-safe-setup", {}, { params });
    return res.data;
  } catch (err) {
    normalizeApiError(err, "Failed to run GL safe setup");
  }
};

// -------------------------
// Optional: drill-down journals (for modals / preview panels)
// -------------------------
export const glListJournals = async ({ startDate, endDate, branchIdOrZoneId, sourceType, sourceId, status, page, limit } = {}) => {
  try {
    const params = {
      ...(hasVal(startDate) ? { startDate } : {}),
      ...(hasVal(endDate) ? { endDate } : {}),
      ...withBranchParams(branchIdOrZoneId),
      ...(hasVal(sourceType) ? { sourceType } : {}),
      ...(hasVal(sourceId) ? { sourceId } : {}),
      ...(hasVal(status) ? { status } : {}),
      ...(hasVal(page) ? { page } : {}),
      ...(hasVal(limit) ? { limit } : {}),
    };

    const res = await httpClient.get("/gl/journals", { params });
    return res.data;
  } catch (err) {
    normalizeApiError(err, "Failed to load journals");
  }
};

// -------------------------
// Optional: reversal
// -------------------------
export const glReverse = async ({ glEntryId, reversalDate, narration, reason, postingVersion } = {}) => {
  try {
    if (!hasVal(glEntryId)) throw new Error("glEntryId is required");

    const payload = {
      glEntryId,
      ...(hasVal(reversalDate) ? { reversalDate } : {}),
      ...(hasVal(narration) ? { narration } : {}),
      ...(hasVal(reason) ? { reason } : {}),
      ...(postingVersion !== undefined && postingVersion !== null ? { postingVersion } : {}),
    };

    const res = await httpClient.post("/gl/reverse", payload);
    return res.data;
  } catch (err) {
    normalizeApiError(err, "Failed to reverse journal");
  }
};

// -------------------------
// Posting batch reports and accounting period locks
// -------------------------
export const glListPostingBatches = async ({ startDate, endDate, branchIdOrZoneId, action, page, limit } = {}) => {
  try {
    const params = {
      ...(hasVal(startDate) ? { startDate } : {}),
      ...(hasVal(endDate) ? { endDate } : {}),
      ...withBranchParams(branchIdOrZoneId),
      ...(hasVal(action) ? { action } : {}),
      ...(hasVal(page) ? { page } : {}),
      ...(hasVal(limit) ? { limit } : {}),
    };
    const res = await httpClient.get("/gl/posting-batches", { params });
    return res.data;
  } catch (err) {
    normalizeApiError(err, "Failed to load posting batches");
  }
};

export const glListPeriods = async ({ startPeriod, endPeriod } = {}) => {
  try {
    const res = await httpClient.get("/gl/periods", { params: { ...(hasVal(startPeriod) ? { startPeriod } : {}), ...(hasVal(endPeriod) ? { endPeriod } : {}) } });
    return res.data;
  } catch (err) {
    normalizeApiError(err, "Failed to load accounting periods");
  }
};

export const glLockPeriod = async ({ periodKey, reason } = {}) => {
  try {
    if (!hasVal(periodKey)) throw new Error("periodKey is required");
    if (!hasVal(reason)) throw new Error("reason is required");
    const res = await httpClient.post("/gl/periods/lock", { periodKey, reason });
    return res.data;
  } catch (err) {
    normalizeApiError(err, "Failed to lock accounting period");
  }
};

export const glReopenPeriod = async ({ periodKey, reason } = {}) => {
  try {
    if (!hasVal(periodKey)) throw new Error("periodKey is required");
    if (!hasVal(reason)) throw new Error("reason is required");
    const res = await httpClient.post("/gl/periods/reopen", { periodKey, reason });
    return res.data;
  } catch (err) {
    normalizeApiError(err, "Failed to reopen accounting period");
  }
};

export const glFinanceConfidence = async ({ startDate, endDate, branchIdOrZoneId } = {}) => {
  try {
    const params = {
      ...(hasVal(startDate) ? { startDate } : {}),
      ...(hasVal(endDate) ? { endDate } : {}),
      ...withBranchParams(branchIdOrZoneId),
    };
    const res = await httpClient.get('/gl/confidence', { params });
    return res.data;
  } catch (err) {
    normalizeApiError(err, 'Failed to load finance data confidence');
  }
};


export const glRequestReversal = async ({ journalId, glEntryId, reason } = {}) => {
  try {
    const id = journalId || glEntryId;
    if (!hasVal(id)) throw new Error('journalId/glEntryId is required');
    if (!hasVal(reason)) throw new Error('reason is required');
    const res = await httpClient.post('/gl/reversal-requests', { journalId: id, reason });
    return res.data;
  } catch (err) { normalizeApiError(err, 'Failed to request GL reversal'); }
};

export const glListReversalRequests = async ({ status, limit } = {}) => {
  try {
    const res = await httpClient.get('/gl/reversal-requests', { params: { ...(hasVal(status) ? { status } : {}), ...(hasVal(limit) ? { limit } : {}) } });
    return res.data;
  } catch (err) { normalizeApiError(err, 'Failed to load GL reversal requests'); }
};

export const glApproveReversalRequest = async ({ requestId, comment, reversalDate, unpostSource = true } = {}) => {
  try {
    if (!hasVal(requestId)) throw new Error('requestId is required');
    const res = await httpClient.post(`/gl/reversal-requests/${requestId}/approve`, { comment, reversalDate, unpostSource });
    return res.data;
  } catch (err) { normalizeApiError(err, 'Failed to approve GL reversal request'); }
};

export const glRejectReversalRequest = async ({ requestId, comment } = {}) => {
  try {
    if (!hasVal(requestId)) throw new Error('requestId is required');
    if (!hasVal(comment)) throw new Error('comment is required');
    const res = await httpClient.post(`/gl/reversal-requests/${requestId}/reject`, { comment });
    return res.data;
  } catch (err) { normalizeApiError(err, 'Failed to reject GL reversal request'); }
};

export const glGenerateFiscalPeriods = async ({ year } = {}) => {
  try {
    const res = await httpClient.post('/gl/periods/generate', { year });
    return res.data;
  } catch (err) { normalizeApiError(err, 'Failed to generate fiscal periods'); }
};

export const glExportJournalsUrl = ({ startDate, endDate, branchIdOrZoneId } = {}) => {
  const params = new URLSearchParams({ ...(hasVal(startDate) ? { startDate } : {}), ...(hasVal(endDate) ? { endDate } : {}), ...withBranchParams(branchIdOrZoneId) });
  return `/api/v2/gl/journals/export?${params.toString()}`;
};
