// src/api/analyticsService.js
import apiClient from './apiClient';

/**
 * Analytics Service (GL-aligned)
 *
 * IMPORTANT:
 * - Dashboard KPIs and Sales Reports should be GL-backed server-side.
 * - Client just passes period/custom range + branch filters.
 *
 * Endpoints used:
 * - GET /api/v2/analytics/dashboard-kpis
 * - GET /api/v2/analytics/sales-report
 *
 * Backward compatible:
 * - getDashboardKpis(branchIdOrZoneId)
 * - getDashboardKpis(period, startDate, endDate, branchIdOrZoneId)
 */

// -------------------------
// tiny utils
// -------------------------
const isArr = (v) => Array.isArray(v);

const toNum = (v, d = 0) => {
  if (v === null && d === null) return null;
  if (v === undefined && d === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const safeObj = (v) => (v && typeof v === 'object' ? v : {});
const hasVal = (v) => v !== undefined && v !== null && String(v).trim() !== '';

// Normalize common API shapes: [] OR {data: []} OR {orders: []} OR {items: []}
const unwrapList = (payload) => {
  if (isArr(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  if (isArr(payload.data)) return payload.data;
  if (isArr(payload.orders)) return payload.orders;
  if (isArr(payload.items)) return payload.items;
  if (payload.data && typeof payload.data === 'object') {
    if (isArr(payload.data.orders)) return payload.data.orders;
    if (isArr(payload.data.items)) return payload.data.items;
  }
  return [];
};

// Build tolerant branch params (backend treats branchId == serviceZoneId)
const withBranchParams = (branchIdOrZoneId) => {
  if (!hasVal(branchIdOrZoneId)) return {};
  return { branchId: branchIdOrZoneId, serviceZoneId: branchIdOrZoneId };
};

// Build period params (backend supports monthly|quarterly|yearly|custom)
const withPeriodParams = (period = 'monthly', startDate, endDate) => {
  const params = { period: period || 'monthly' };
  if (hasVal(startDate) && hasVal(endDate)) {
    params.period = 'custom';
    params.startDate = startDate;
    params.endDate = endDate;
  }
  return params;
};

// Safe GET helper (keeps this file consistent)
const safeGet = async (url, params, fallback = null) => {
  try {
    const res = await apiClient.get(url, { params });
    return res.data;
  } catch (e) {
    if (fallback !== null) return fallback;
    throw e;
  }
};

// -------------------------
// Dashboard + Sales
// -------------------------
export const getDashboardKpis = async (...args) => {
  let period = 'monthly';
  let startDate;
  let endDate;
  let branchIdOrZoneId;

  // old signature: (branchIdOrZoneId)
  // new signature: (period, startDate, endDate, branchIdOrZoneId)
  if (args.length === 1) {
    branchIdOrZoneId = args[0];
  } else {
    [period, startDate, endDate, branchIdOrZoneId] = args;
  }

  const params = {
    ...withPeriodParams(period, startDate, endDate),
    ...withBranchParams(branchIdOrZoneId),
  };

  const d = safeObj(await safeGet('/api/v2/analytics/dashboard-kpis', params, {}));

  return {
    // GL-backed numbers (expected)
    totalRevenue: toNum(d.totalRevenue, 0),
    totalKgSold: toNum(d.totalKgSold, 0),
    activeDeliveries: toNum(d.activeDeliveries, 0),
    currentBulkStock: toNum(d.currentBulkStock, 0),

    period: safeObj(d.period),
    branch: safeObj(d.branch),

    // explicit GL breakdown (recommended)
    breakdown: {
      posRevenue: toNum(d?.breakdown?.posRevenue, 0),
      deliveryRecognizedRevenue: toNum(d?.breakdown?.deliveryRecognizedRevenue, 0),
    },

    raw: d,
  };
};

export const getSalesReport = async (...args) => {
  let period = 'monthly';
  let startDate;
  let endDate;
  let branchIdOrZoneId;

  // old: (period, branchIdOrZoneId)
  // new: (period, startDate, endDate, branchIdOrZoneId)
  if (args.length <= 2) {
    period = args[0] || 'monthly';
    branchIdOrZoneId = args[1];
  } else {
    [period, startDate, endDate, branchIdOrZoneId] = args;
  }

  const params = {
    ...withPeriodParams(period, startDate, endDate),
    ...withBranchParams(branchIdOrZoneId),
  };

  const rows = unwrapList(await safeGet('/api/v2/analytics/sales-report', params, []));

  // Backend format: [{ _id:{year,month}, totalRevenue, totalKgSold, count? }]
  const breakdown = rows.map((r) => {
    const year = r?._id?.year;
    const month = r?._id?.month;
    const label = year && month ? `${year}-${String(month).padStart(2, '0')}` : 'N/A';
    return {
      label,
      revenue: toNum(r?.totalRevenue, 0),
      kgSold: toNum(r?.totalKgSold, 0),
      count: toNum(r?.count, 0),
      _id: r?._id || null,
    };
  });

  const totalRevenue = breakdown.reduce((s, x) => s + toNum(x.revenue, 0), 0);
  const totalKgSold = breakdown.reduce((s, x) => s + toNum(x.kgSold, 0), 0);

  return {
    period: hasVal(startDate) && hasVal(endDate) ? 'custom' : period,
    breakdown,
    totalRevenue,
    totalKgSold,
    raw: rows,
  };
};

export const getSalesChartData = getSalesReport;

// -------------------------
// Other endpoints (kept intact)
// -------------------------
export const getSalesByPaymentMethod = async (optsOrBranch) => {
  const opts =
    typeof optsOrBranch === 'object' && optsOrBranch !== null
      ? optsOrBranch
      : { branchIdOrZoneId: optsOrBranch };

  const params = {
    ...withPeriodParams(opts.period || 'monthly', opts.startDate, opts.endDate),
    ...withBranchParams(opts.branchIdOrZoneId),
  };

  const rows = unwrapList(await safeGet('/api/v2/analytics/sales-by-payment-method', params, []));

  return rows.map((r) => ({
    method: r?._id || 'Unknown',
    totalRevenue: toNum(r?.totalRevenue, 0),
    totalKgSold: toNum(r?.totalKgSold, 0),
    count: toNum(r?.count, 0),
    raw: r,
  }));
};

export const getTopSellingProducts = async (optsOrBranch) => {
  const opts =
    typeof optsOrBranch === 'object' && optsOrBranch !== null
      ? optsOrBranch
      : { branchIdOrZoneId: optsOrBranch };

  const params = {
    ...withPeriodParams(opts.period || 'monthly', opts.startDate, opts.endDate),
    ...withBranchParams(opts.branchIdOrZoneId),
  };

  const rows = unwrapList(await safeGet('/api/v2/analytics/top-selling-products', params, []));

  return rows.map((r) => ({
    productName: r?._id || 'Unknown',
    totalQuantitySold: toNum(r?.totalQuantitySold, 0),
    totalRevenue: toNum(r?.totalRevenue, 0),
    raw: r,
  }));
};

export const getSalesByBranch = async (opts = {}) => {
  const params = {
    ...withPeriodParams(opts.period || 'monthly', opts.startDate, opts.endDate),
    ...withBranchParams(opts.branchIdOrZoneId),
  };

  const rows = unwrapList(await safeGet('/api/v2/analytics/sales-by-branch', params, []));

  return rows.map((r) => ({
    branchId: r?.branchId ?? null,
    branchName: r?.branchName || null,
    totalRevenue: toNum(r?.totalRevenue, 0),
    totalKgSold: toNum(r?.totalKgSold, 0),
    count: toNum(r?.count, 0),
    raw: r,
  }));
};

// -------------------------
// Heatmap (unchanged behavior)
// -------------------------
export const getHeatmapData = async (opts = {}) => {
  const mode = opts?.mode === 'volume' ? 'volume' : 'revenue';
  const branchParams = withBranchParams(opts?.branchIdOrZoneId);
  const periodParams = withPeriodParams(opts?.period || 'monthly', opts?.startDate, opts?.endDate);

  // Preferred endpoint
  try {
    const rows = unwrapList(
      await safeGet('/api/v2/analytics/heatmap', { mode, ...periodParams, ...branchParams }, [])
    );

    return rows
      .map((p) => ({
        lat: toNum(p?.lat ?? p?.latitude ?? p?.deliveryLatitude, null),
        lng: toNum(p?.lng ?? p?.longitude ?? p?.deliveryLongitude, null),
        weight: toNum(p?.weight ?? p?.value ?? p?.grandTotal ?? p?.amount, 0),
      }))
      .filter((p) => p.lat !== null && p.lng !== null);
  } catch (e) {
    // fallback legacy below
  }

  // Legacy fallback
  try {
    const orders = unwrapList(
      await safeGet(
        '/orders',
        {
          limit: 2000,
          fields: 'deliveryLatitude,deliveryLongitude,grandTotal',
          ...safeObj(branchParams),
        },
        []
      )
    );

    return orders
      .map((o) => {
        const lat = toNum(o?.deliveryLatitude, null);
        const lng = toNum(o?.deliveryLongitude, null);
        const weight = mode === 'volume' ? 1 : toNum(o?.grandTotal, 0);
        return { lat, lng, weight };
      })
      .filter((p) => p.lat !== null && p.lng !== null);
  } catch (e) {
    console.error('Heatmap Data Error', e);
    return [];
  }
};

// -------------------------
// GL/BI additions (required by new screens)
// -------------------------
export const getBusinessMetrics = async ({ period = 'monthly', startDate, endDate, branchIdOrZoneId } = {}) => {
  const params = {
    ...withPeriodParams(period, startDate, endDate),
    ...withBranchParams(branchIdOrZoneId),
  };
  return safeGet('/api/v2/analytics/business-metrics', params, {});
};

export const getDriverPerformance = async ({
  period = 'monthly',
  startDate,
  endDate,
  branchIdOrZoneId,
  driverId,
} = {}) => {
  const params = {
    ...withPeriodParams(period, startDate, endDate),
    ...withBranchParams(branchIdOrZoneId),
  };
  if (hasVal(driverId)) params.driverId = driverId;
  return safeGet('/api/v2/analytics/driver-performance', params, {});
};