// src/api/logisticsService.js
import apiClient from './apiClient';

/**
 * NOTE:
 * - Kept as compatibility wrapper so older imports don't break.
 * - Uses v2 logistics controller path.
 * - Normalized errors for UI consistency.
 */

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

export const assignOrderToVan = async (vanId, orderId, options = {}) => {
  try {
    if (!vanId || !orderId) throw new Error('vanId and orderId are required');

    // v2 backend path (matches src/api/v2/logistics/logistics.controller.js)
    const res = await apiClient.post('/api/v2/logistics/assign-order', { vanId, orderId }, options);
    return res.data;
  } catch (err) {
    throwNormalized(err, 'Failed to assign order to van');
  }
};
