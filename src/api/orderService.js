// src/api/orderService.js
import httpClient from "./httpClient";

/**
 * Order Service
 *
 * IMPORTANT:
 * - httpClient baseURL ALREADY includes: <API_URL>/api/v2
 * - Therefore: DO NOT prefix "/api/v2" in the paths below,
 *   or you will get: /api/v2/api/v2/... (404)
 *
 * Keeps:
 * - logistics helpers used by Logistics/Command Center
 *
 * Adds:
 * - getOrderById
 * - getOrderFinancialTrace (GL Journals lookup for Financial tab)
 */

const normalizeApiError = (err, fallback = "Request failed") => {
  const status = err?.response?.status;
  const serverMsg = err?.response?.data?.message || err?.response?.data?.error || err?.response?.data?.msg;
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

export const getUnassignedOrders = async (options = {}) => {
  try {
    const { data } = await httpClient.get("/orders/unassigned", options);
    return data?.orders || data || [];
  } catch (err) {
    throwNormalized(err, "Failed to load unassigned orders");
  }
};

export const getOrderById = async (orderId, options = {}) => {
  try {
    if (!orderId) throw new Error("orderId is required");
    const { data } = await httpClient.get(`/orders/${orderId}`, options);
    return data || null;
  } catch (err) {
    throwNormalized(err, "Failed to load order");
  }
};

/**
 * GL Trace for an order (Financial tab)
 * Backend endpoint:
 *   GET /api/v2/gl/journals?sourceType=ORDER&sourceId=<mongoId>
 *
 * Since httpClient already includes /api/v2, we call:
 *   GET /gl/journals?...
 *
 * If it doesn't exist yet, returns null so UI can hide the section.
 */
export const getOrderFinancialTrace = async (orderMongoId, options = {}) => {
  try {
    if (!orderMongoId) throw new Error("orderMongoId is required");
    const { data } = await httpClient.get("/gl/journals", {
      params: { sourceType: "ORDER", sourceId: String(orderMongoId) },
      ...options,
    });
    return data || null;
  } catch (err) {
    const status = err?.response?.status;
    if ([404, 405].includes(status)) return null;
    throwNormalized(err, "Failed to load order financial trace");
  }
};

export const assignOrderToVan = async (vanId, orderId, orderDetails = {}, options = {}) => {
  try {
    if (!vanId) throw new Error("vanId is required");
    if (!orderId) throw new Error("orderId is required");

    // Legacy attempt (some installs still use runs assignment)
    try {
      const { data } = await httpClient.post(
        `/runs/${orderId}/assign-driver`,
        { driverId: vanId, orderDetails },
        options
      );
      return data;
    } catch (legacyErr) {
      const status = legacyErr?.response?.status;
      if (![404, 405].includes(status)) throw legacyErr;

      // v2 logistics assignment
      // Backend full path: POST /api/v2/logistics/assign-order
      // httpClient path:
      const { data } = await httpClient.post(
        "/logistics/assign-order",
        { vanId, orderId, orderDetails },
        options
      );
      return data;
    }
  } catch (err) {
    throwNormalized(err, "Failed to assign order to driver");
  }
};