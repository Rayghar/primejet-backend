// src/api/runService.js
import apiClient from './apiClient';

// NOTE:
// - Unified to apiClient (same auth/baseURL behavior as your other v2 services)
// - Kept endpoint paths exactly as in your pasted version
// - Added normalized errors + optional options params

const normalizeApiError = (err, fallback = 'Request failed') => {
  const status = err?.response?.status;
  const serverMsg =
    err?.response?.data?.message ||
    err?.response?.data?.error ||
    err?.response?.data?.msg;

  const msg = serverMsg || err?.message || fallback;
  return { message: msg, status, raw: err };
};

const throwNormalized = (err, fallback) => {
  const ex = normalizeApiError(err, fallback);
  const e = new Error(ex.message);
  e.status = ex.status;
  e.raw = ex.raw;
  throw e;
};

export const getActiveRuns = async (options = {}) => {
  try {
    const res = await apiClient.get('/runs/admin/active', options);
    return res.data;
  } catch (err) {
    throwNormalized(err, 'Failed to load active runs');
  }
};

export const getRunDetails = async (runId, options = {}) => {
  try {
    if (!runId) throw new Error('runId is required');
    const res = await apiClient.get(`/runs/${runId}`, options);
    return res.data;
  } catch (err) {
    throwNormalized(err, 'Failed to load run details');
  }
};

export const getDriverRunHistory = async (driverId, filters = {}, options = {}) => {
  try {
    if (!driverId) throw new Error('driverId is required');
    const res = await apiClient.get(`/runs/driver/${driverId}/history`, {
      ...options,
      params: { ...(options?.params || {}), ...(filters || {}) },
    });
    return res.data;
  } catch (err) {
    throwNormalized(err, 'Failed to load driver run history');
  }
};

export const getUnassignedOrders = async (options = {}) => {
  try {
    const res = await apiClient.get('/runs/admin/unassigned-orders', options);
    // Your UI expects array. Backend sometimes returns { orders: [...] }
    return res.data?.orders || res.data || [];
  } catch (err) {
    throwNormalized(err, 'Failed to load unassigned orders');
  }
};

export const assignDriverToRun = async (runId, driverId, options = {}) => {
  try {
    if (!runId) throw new Error('runId is required');
    if (!driverId) throw new Error('driverId is required');
    const res = await apiClient.put(`/runs/${runId}/assign-driver`, { driverId }, options);
    return res.data;
  } catch (err) {
    throwNormalized(err, 'Failed to assign driver');
  }
};
