// src/api/supportService.js
import apiClient from './apiClient';

/**
 * ✅ Support Service
 * Single façade for Support Desk:
 * - Chat threads/history/send
 * - Customers + customer orders
 * - Support hub snapshot (unassigned + active runs + customers)
 *
 * Enhancements:
 * - consistent res.data returns
 * - normalized errors
 * - optional options param (AbortController signal, headers, etc.)
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

// -----------------------------
// Customers
// -----------------------------
export const getCustomers = async (search = '', page = 1, options = {}) => {
  try {
    const params = { page, limit: 20, search };
    const res = await apiClient.get('/api/v2/customers', { ...options, params });
    return res.data;
  } catch (err) {
    throwNormalized(err, 'Failed to load customers');
  }
};

export const getCustomerOrders = async (customerId, options = {}) => {
  try {
    if (!customerId) throw new Error('customerId is required');
    const res = await apiClient.get(`/api/v2/customers/${customerId}/orders`, options);
    return res.data;
  } catch (err) {
    throwNormalized(err, 'Failed to load customer orders');
  }
};

// -----------------------------
// Chat (v1 endpoints kept intact)
// -----------------------------
export const getActiveChatThreads = async (options = {}) => {
  try {
    const res = await apiClient.get('/api/v1/chat/threads', {
      ...options,
      params: { role: 'admin', ...(options?.params || {}) },
    });
    return res.data;
  } catch (err) {
    throwNormalized(err, 'Failed to load chat threads');
  }
};

export const getChatHistory = async (chatId, options = {}) => {
  try {
    if (!chatId) throw new Error('chatId is required');
    const res = await apiClient.get(`/api/v1/chat/${chatId}/history`, options);
    return res.data;
  } catch (err) {
    throwNormalized(err, 'Failed to load chat history');
  }
};

export const sendMessage = async (chatId, text, recipientId, options = {}) => {
  try {
    if (!chatId) throw new Error('chatId is required');
    if (!text?.trim()) throw new Error('message text is required');

    const res = await apiClient.post(
      '/api/v1/chat/message',
      { chatId, text: text.trim(), recipientId },
      options
    );
    return res.data;
  } catch (err) {
    throwNormalized(err, 'Failed to send message');
  }
};

// -----------------------------
// Hub snapshot (best-effort)
// -----------------------------
const safeArr = (v) => (Array.isArray(v) ? v : []);
const safeOrdersArray = (resData) => safeArr(resData?.orders || resData?.data || resData);

export const getSupportHub = async (options = {}) => {
  try {
    // These are used elsewhere in your app (runs endpoints).
    // If your backend mounts differently, adjust ONLY these paths.
    const [unassigned, activeRuns, customers] = await Promise.allSettled([
      apiClient.get('/runs/admin/unassigned-orders', options),
      apiClient.get('/runs/admin/active', options),
      apiClient.get('/api/v2/customers', { ...options, params: { page: 1, limit: 20, search: '' } }),
    ]);

    const unassignedOrders =
      unassigned.status === 'fulfilled' ? safeOrdersArray(unassigned.value?.data) : [];
    const activeRunsRaw =
      activeRuns.status === 'fulfilled' ? safeArr(activeRuns.value?.data) : [];
    const customersPayload =
      customers.status === 'fulfilled' ? customers.value?.data : null;

    return {
      unassignedOrders,
      activeRuns: activeRunsRaw,
      customers: customersPayload,
      partial:
        unassigned.status === 'rejected' ||
        activeRuns.status === 'rejected' ||
        customers.status === 'rejected',
    };
  } catch (err) {
    throwNormalized(err, 'Failed to load support hub');
  }
};
