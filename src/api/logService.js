// src/api/logService.js
import httpClient from './httpClient';

/**
 * Fetches system audit logs from the backend.
 * @param {object} filters - Optional filters like { page, limit, search, action, userId }.
 * @returns {Promise<object>} An object containing logs, currentPage, totalPages, totalLogs.
 */
const getAuditLogs = async (filters = {}) => {
  const { data } = await httpClient.get('/logs/audit', { params: filters });
  return data;
};

// You might add other log-related functions here if needed (e.g., getAppLogs)

export { getAuditLogs };