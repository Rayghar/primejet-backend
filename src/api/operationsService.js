// src/api/operationsService.js
import apiClient from "./apiClient";

/**
 * Operations Service (v2)
 * - Vans, runs, dispatch helpers
 * - Plants + maintenance
 * - Stock-ins (Inventory purchases) for WAC + GL posting
 *
 * Backend endpoints expected (v2):
 * - GET  /api/v2/operations/vans
 * - GET  /api/v2/operations/plants
 * - POST /api/v2/operations/plants
 * - GET  /api/v2/operations/plants/:plantId/maintenance
 * - POST /api/v2/operations/plants/:plantId/maintenance
 * - GET  /api/v2/operations/plants/:plantId/daily-output-history   (⚠️ backend path)
 * - GET  /api/v2/operations/stock-ins
 * - POST /api/v2/operations/stock-ins
 *
 * Legacy fallbacks:
 * - GET /vans
 */

// -----------------------------
// Helpers
// -----------------------------
const safeArray = (v) => (Array.isArray(v) ? v : []);
const safeDataArray = (res) => safeArray(res?.data);
const safeOrdersArray = (res) => safeArray(res?.data?.orders || res?.data);
const safeDriversArray = (res) => safeArray(res?.data);

const hasVal = (v) => v !== undefined && v !== null && String(v).trim() !== "";

const withBranchParams = (branchIdOrZoneId) => {
  if (!hasVal(branchIdOrZoneId)) return {};
  return { branchId: branchIdOrZoneId, serviceZoneId: branchIdOrZoneId };
};

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

const mergeConfig = (options = {}, extra = {}) => ({
  ...options,
  ...extra,
  params: {
    ...(options?.params || {}),
    ...(extra?.params || {}),
  },
});

// -----------------------------
// Vans
// -----------------------------
export const getVans = async (branchId = null, options = {}) => {
  try {
    const params = branchId ? { branchId } : {};
    const res = await apiClient.get("/api/v2/operations/vans", mergeConfig(options, { params }));
    return safeDataArray(res);
  } catch (e) {
    // legacy fallback
    try {
      const params = branchId ? { branchId } : {};
      const res2 = await apiClient.get("/vans", mergeConfig(options, { params }));
      return safeDataArray(res2);
    } catch (err) {
      throwNormalized(err, "Failed to load vans");
    }
  }
};

// -----------------------------
// Logistics & Runs (v1 legacy paths)
// -----------------------------
export const getUnassignedOrders = async (zoneId = null, options = {}) => {
  try {
    const params = zoneId ? { zoneId } : {};
    const res = await apiClient.get("/runs/admin/unassigned-orders", mergeConfig(options, { params }));
    return safeOrdersArray(res);
  } catch (err) {
    throwNormalized(err, "Failed to load unassigned orders");
  }
};

export const getOnlineDrivers = async (options = {}) => {
  try {
    const res = await apiClient.get(
      "/users",
      mergeConfig(options, {
        params: { role: "driver", isAvailableOnline: true },
      })
    );
    return safeDriversArray(res);
  } catch (err) {
    throwNormalized(err, "Failed to load online drivers");
  }
};

export const createRunFromBatch = async (orderIds, options = {}) => {
  try {
    const ids = safeArray(orderIds).filter(Boolean);
    if (ids.length === 0) throw new Error("orderIds is required");
    const res = await apiClient.post("/runs/admin/create-batch", { orderIds: ids }, options);
    return res.data;
  } catch (err) {
    throwNormalized(err, "Failed to create run batch");
  }
};

export const getActiveRuns = async (options = {}) => {
  try {
    const res = await apiClient.get("/runs/admin/active", options);
    return safeDataArray(res);
  } catch (err) {
    throwNormalized(err, "Failed to load active runs");
  }
};

export const assignDriver = async (runId, driverId, options = {}) => {
  try {
    if (!runId) throw new Error("runId is required");
    if (!driverId) throw new Error("driverId is required");
    const res = await apiClient.put(`/runs/${runId}/assign-driver`, { driverId }, options);
    return res.data;
  } catch (err) {
    throwNormalized(err, "Failed to assign driver");
  }
};

// Convenience alias
export const assignDriverToRun = assignDriver;

// -----------------------------
// Inventory summary (optional endpoint, safe wrapper)
// -----------------------------
export const getInventorySummary = async (branchIdOrZoneId, options = {}) => {
  try {
    const params = withBranchParams(branchIdOrZoneId);
    const res = await apiClient.get("/api/v2/inventory/summary", mergeConfig(options, { params }));

    const d = res.data || {};

    // Backend source of truth
    const currentBulkLpgKg = Number(d.currentBulkLpgKg) || 0;
    const totalStockedKg = Number(d.totalStockedKg) || 0;

    // Dashboard-friendly aliases
    return {
      ...d,
      currentStock: Number(d.currentStock ?? currentBulkLpgKg) || 0,
      totalCapacity: Number(d.totalCapacity ?? totalStockedKg) || 0,
      currentBulkLpgKg,
      totalStockedKg,
      totalSoldKg: Number(d.totalSoldKg) || 0,
      totalCylinders: Number(d.totalCylinders) || 0,
      lowStockAlert: Boolean(d.lowStockAlert),
      stockUtilizationPct: Number(d.stockUtilizationPct) || 0,
    };
  } catch (err) {
    throwNormalized(err, "Failed to load inventory summary");
  }
};

// -----------------------------
// Plant Operations
// -----------------------------
export const getPlants = async (branchIdOrZoneId = null, options = {}) => {
  try {
    const params = withBranchParams(branchIdOrZoneId);
    const res = await apiClient.get("/api/v2/operations/plants", mergeConfig(options, { params }));
    return safeDataArray(res);
  } catch (err) {
    throwNormalized(err, "Failed to load plants");
  }
};

export const addPlant = async (plantData, options = {}) => {
  try {
    const res = await apiClient.post("/api/v2/operations/plants", plantData, options);
    return res.data;
  } catch (err) {
    throwNormalized(err, "Failed to add plant");
  }
};

export const getMaintenanceLogs = async (plantId, options = {}) => {
  try {
    if (!hasVal(plantId)) throw new Error("plantId is required");
    const res = await apiClient.get(`/api/v2/operations/plants/${plantId}/maintenance`, options);
    return safeDataArray(res);
  } catch (err) {
    throwNormalized(err, "Failed to load maintenance logs");
  }
};

export const addMaintenanceLog = async (plantId, logData, options = {}) => {
  try {
    if (!hasVal(plantId)) throw new Error("plantId is required");
    const res = await apiClient.post(`/api/v2/operations/plants/${plantId}/maintenance`, logData, options);
    return res.data;
  } catch (err) {
    throwNormalized(err, "Failed to add maintenance log");
  }
};

/**
 * Plant output history
 * ⚠️ Backend route is: /plants/:plantId/daily-output-history (per your uploaded backend routes)
 */
export const getPlantDailyOutputHistory = async (plantId, days = 7, options = {}) => {
  try {
    if (!hasVal(plantId)) throw new Error("plantId is required");
    const res = await apiClient.get(
      `/api/v2/operations/plants/${plantId}/daily-output-history`,
      mergeConfig(options, { params: { days } })
    );
    return safeDataArray(res);
  } catch (err) {
    throwNormalized(err, "Failed to load plant output history");
  }
};

// -----------------------------
// Stock Ins (required by Inventory + LogStockInModal)
// -----------------------------
export const getStockIns = async (branchIdOrZoneId = null, options = {}) => {
  try {
    const params = {
      ...withBranchParams(branchIdOrZoneId),
      ...(options?.params || {}),
    };

    // If user passed branchId/serviceZoneId in options.params, keep them.
    const res = await apiClient.get("/api/v2/operations/stock-ins", mergeConfig(options, { params }));
    return res.data;
  } catch (err) {
    throwNormalized(err, "Failed to load stock-ins");
  }
};

export const addStockIn = async (payload, options = {}) => {
  try {
    const res = await apiClient.post("/api/v2/operations/stock-ins", payload, options);
    return res.data;
  } catch (err) {
    throwNormalized(err, "Failed to add stock-in");
  }
};