// src/api/customerService.js
import apiClient from './apiClient';

/**
 * ✅ Enhancements:
 * - consistent res.data returns
 * - normalized errors
 * - optional options param (supports AbortController signal, headers, etc.)
 * - safe param merging so caller params aren't overwritten
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

const mergeConfig = (options = {}, extra = {}) => ({
  ...options,
  ...extra,
  params: {
    ...(options?.params || {}),
    ...(extra?.params || {}),
  },
});

export const getCustomers = async (search = '', page = 1, options = {}) => {
  try {
    const params = { page, limit: 20, search };
    const res = await apiClient.get('/api/v2/customers', mergeConfig(options, { params }));
    return res.data;
  } catch (err) {
    throwNormalized(err, 'Failed to load customers');
  }
};

export const addCustomer = async (customerData, options = {}) => {
  try {
    const res = await apiClient.post('/api/v2/customers', customerData, options);
    return res.data;
  } catch (err) {
    throwNormalized(err, 'Failed to add customer');
  }
};

export const getCustomerDetails = async (customerId, options = {}) => {
  try {
    if (!customerId) throw new Error('customerId is required');
    const res = await apiClient.get(`/api/v2/customers/${customerId}`, options);
    return res.data;
  } catch (err) {
    throwNormalized(err, 'Failed to load customer details');
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

export const addCustomerNote = async (customerId, text, authorEmail, options = {}) => {
  try {
    if (!customerId) throw new Error('customerId is required');
    if (!text?.trim()) throw new Error('note text is required');

    const res = await apiClient.post(
      `/api/v2/customers/${customerId}/notes`,
      { text: text.trim(), authorEmail },
      options
    );
    return res.data;
  } catch (err) {
    throwNormalized(err, 'Failed to add note');
  }
};

export const getCustomerNotes = async (customerId, options = {}) => {
  try {
    if (!customerId) throw new Error('customerId is required');
    const res = await apiClient.get(`/api/v2/customers/${customerId}/notes`, options);
    return res.data;
  } catch (err) {
    throwNormalized(err, 'Failed to load notes');
  }
};

// Chat Support (v1 endpoints kept intact)
export const getActiveChatThreads = async (options = {}) => {
  try {
    const res = await apiClient.get(
      '/api/v1/chat/threads',
      mergeConfig(options, { params: { role: 'admin' } })
    );
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
