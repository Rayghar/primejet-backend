// src/api/inventoryService.js
import apiClient from './apiClient';

// -----------------------------
// Helpers
// -----------------------------
const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : v;
};

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

const buildScopeParams = (branchIdOrOptions, maybeOptions = {}) => {
  // supports:
  //   fn()
  //   fn(branchId)
  //   fn({ signal, headers })
  //   fn(branchId, { signal })
  let branchId = null;
  let options = {};

  if (
    branchIdOrOptions &&
    typeof branchIdOrOptions === 'object' &&
    !Array.isArray(branchIdOrOptions)
  ) {
    options = branchIdOrOptions;
  } else if (branchIdOrOptions) {
    branchId = branchIdOrOptions;
    options = maybeOptions || {};
  }

  const params = {
    ...(options.params || {}),
  };

  if (branchId) {
    params.branchId = branchId;
  }

  return {
    ...options,
    params,
  };
};

// --- Inventory & Stock ---
export const getInventorySummary = async (branchIdOrOptions, options) => {
  try {
    const config = buildScopeParams(branchIdOrOptions, options);
    const res = await apiClient.get('/api/v2/inventory/summary', config);
    return res.data;
  } catch (err) {
    throwNormalized(err, 'Failed to load inventory summary');
  }
};

export const getStockInHistory = async (branchIdOrOptions, options) => {
  try {
    const config = buildScopeParams(branchIdOrOptions, options);
    const res = await apiClient.get('/api/v2/inventory/stock-in-history', config);
    return res.data;
  } catch (err) {
    throwNormalized(err, 'Failed to load stock-in history');
  }
};

export const addStockIn = async (data, options = {}) => {
  try {
    // Normalize numeric fields defensively (UI sometimes sends strings)
    const payload = {
      ...data,
      quantityKg: data?.quantityKg !== undefined ? toNum(data.quantityKg) : data?.quantityKg,
      costPerKg: data?.costPerKg !== undefined ? toNum(data.costPerKg) : data?.costPerKg,
      targetSalePricePerKg:
        data?.targetSalePricePerKg !== undefined
          ? toNum(data.targetSalePricePerKg)
          : data?.targetSalePricePerKg,
      // ✅ backend supports branchId (or serviceZoneId alias)
      branchId: data?.branchId || data?.serviceZoneId,
    };

    const res = await apiClient.post('/api/v2/inventory/stock-in', payload, options);
    return res.data;
  } catch (err) {
    throwNormalized(err, 'Failed to add stock-in');
  }
};

// --- Cylinders ---
export const getCylinders = async (branchIdOrOptions, options) => {
  try {
    const config = buildScopeParams(branchIdOrOptions, options);
    const res = await apiClient.get('/api/v2/inventory/cylinders', config);
    return res.data;
  } catch (err) {
    throwNormalized(err, 'Failed to load cylinders');
  }
};

export const addCylinder = async (data, options = {}) => {
  try {
    const payload = {
      ...data,
      quantity: data?.quantity !== undefined ? toNum(data.quantity) : data?.quantity,
      branchId: data?.branchId || data?.serviceZoneId,
    };
    const res = await apiClient.post('/api/v2/inventory/cylinders', payload, options);
    return res.data;
  } catch (err) {
    throwNormalized(err, 'Failed to add cylinder');
  }
};

export const deleteCylinder = async (id, options = {}) => {
  try {
    if (!id) throw new Error('cylinder id is required');
    const res = await apiClient.delete(`/api/v2/inventory/cylinders/${id}`, options);
    return res.data;
  } catch (err) {
    throwNormalized(err, 'Failed to delete cylinder');
  }
};

// --- Assets ---
export const getAssets = async (branchIdOrOptions, options) => {
  try {
    const config = buildScopeParams(branchIdOrOptions, options);
    const res = await apiClient.get('/api/v2/inventory/assets', config);
    return res.data;
  } catch (err) {
    throwNormalized(err, 'Failed to load assets');
  }
};

export const addAsset = async (data, options = {}) => {
  try {
    const payload = {
      ...data,
      cost: data?.cost !== undefined ? toNum(data.cost) : data?.cost,
      branchId: data?.branchId || data?.serviceZoneId,
    };
    const res = await apiClient.post('/api/v2/inventory/assets', payload, options);
    return res.data;
  } catch (err) {
    throwNormalized(err, 'Failed to add asset');
  }
};

export const deleteAsset = async (id, options = {}) => {
  try {
    if (!id) throw new Error('asset id is required');
    const res = await apiClient.delete(`/api/v2/inventory/assets/${id}`, options);
    return res.data;
  } catch (err) {
    throwNormalized(err, 'Failed to delete asset');
  }
};

// --- Loans ---
export const getLoans = async (branchIdOrOptions, options) => {
  try {
    const config = buildScopeParams(branchIdOrOptions, options);
    const res = await apiClient.get('/api/v2/inventory/loans', config);
    return res.data;
  } catch (err) {
    throwNormalized(err, 'Failed to load loans');
  }
};

export const addLoan = async (data, options = {}) => {
  try {
    const payload = {
      ...data,
      principal: data?.principal !== undefined ? toNum(data.principal) : data?.principal,
      interestRate: data?.interestRate !== undefined ? toNum(data.interestRate) : data?.interestRate,
      term: data?.term !== undefined ? toNum(data.term) : data?.term,
      branchId: data?.branchId || data?.serviceZoneId,
    };
    const res = await apiClient.post('/api/v2/inventory/loans', payload, options);
    return res.data;
  } catch (err) {
    throwNormalized(err, 'Failed to add loan');
  }
};

export const deleteLoan = async (id, options = {}) => {
  try {
    if (!id) throw new Error('loan id is required');
    const res = await apiClient.delete(`/api/v2/inventory/loans/${id}`, options);
    return res.data;
  } catch (err) {
    throwNormalized(err, 'Failed to delete loan');
  }
};

// --- Wave 3: stock controls, COGS and profitability ---
export const loadOpeningStock = async (data, options = {}) => {
  try {
    const payload = {
      ...data,
      quantityKg: data?.quantityKg !== undefined ? toNum(data.quantityKg) : data?.quantityKg,
      costPerKg: data?.costPerKg !== undefined ? toNum(data.costPerKg) : data?.costPerKg,
      targetSalePricePerKg: data?.targetSalePricePerKg !== undefined ? toNum(data.targetSalePricePerKg) : data?.targetSalePricePerKg,
      branchId: data?.branchId || data?.serviceZoneId,
    };
    const res = await apiClient.post('/api/v2/inventory/opening-stock', payload, options);
    return res.data;
  } catch (err) {
    throwNormalized(err, 'Failed to load opening stock');
  }
};

export const getStockMovements = async (params = {}, options = {}) => {
  try {
    const res = await apiClient.get('/api/v2/inventory/stock-movements', { ...options, params });
    return res.data;
  } catch (err) {
    throwNormalized(err, 'Failed to load stock movements');
  }
};

export const reconcileStock = async (data, options = {}) => {
  try {
    const payload = {
      ...data,
      physicalQtyKg: data?.physicalQtyKg !== undefined ? toNum(data.physicalQtyKg) : data?.physicalQtyKg,
      branchId: data?.branchId || data?.serviceZoneId,
    };
    const res = await apiClient.post('/api/v2/inventory/reconciliations', payload, options);
    return res.data;
  } catch (err) {
    throwNormalized(err, 'Failed to reconcile stock');
  }
};

export const getReconciliations = async (params = {}, options = {}) => {
  try {
    const res = await apiClient.get('/api/v2/inventory/reconciliations', { ...options, params });
    return res.data;
  } catch (err) {
    throwNormalized(err, 'Failed to load reconciliations');
  }
};

export const getGrossProfitReport = async (params = {}, options = {}) => {
  try {
    const res = await apiClient.get('/api/v2/inventory/gross-profit', { ...options, params });
    return res.data;
  } catch (err) {
    throwNormalized(err, 'Failed to load gross profit report');
  }
};

export const getBranchProfitabilityReport = async (params = {}, options = {}) => {
  try {
    const res = await apiClient.get('/api/v2/inventory/branch-profitability', { ...options, params });
    return res.data;
  } catch (err) {
    throwNormalized(err, 'Failed to load branch profitability report');
  }
};

// --- Wave 9: product, pricing, branch mapping and setup controls ---
export const getProducts = async (params = {}, options = {}) => {
  try {
    const res = await apiClient.get('/api/v2/inventory/products', { ...options, params });
    return res.data;
  } catch (err) {
    throwNormalized(err, 'Failed to load products');
  }
};

export const saveProduct = async (data, options = {}) => {
  try {
    const payload = {
      ...data,
      defaultKg: data?.defaultKg !== undefined ? toNum(data.defaultKg) : data?.defaultKg,
      defaultSellingPrice: data?.defaultSellingPrice !== undefined ? toNum(data.defaultSellingPrice) : data?.defaultSellingPrice,
    };
    const res = await apiClient.post('/api/v2/inventory/products', payload, options);
    return res.data;
  } catch (err) {
    throwNormalized(err, 'Failed to save product');
  }
};

export const getBranchPrices = async (params = {}, options = {}) => {
  try {
    const res = await apiClient.get('/api/v2/inventory/branch-prices', { ...options, params });
    return res.data;
  } catch (err) {
    throwNormalized(err, 'Failed to load branch prices');
  }
};

export const saveBranchPrice = async (data, options = {}) => {
  try {
    const payload = {
      ...data,
      branchId: data?.branchId || data?.serviceZoneId,
      pricePerKg: data?.pricePerKg !== undefined ? toNum(data.pricePerKg) : data?.pricePerKg,
      fixedPrice: data?.fixedPrice !== undefined ? toNum(data.fixedPrice) : data?.fixedPrice,
    };
    const res = await apiClient.post('/api/v2/inventory/branch-prices', payload, options);
    return res.data;
  } catch (err) {
    throwNormalized(err, 'Failed to save branch price');
  }
};

export const lookupEffectivePrice = async (params = {}, options = {}) => {
  try {
    const res = await apiClient.get('/api/v2/inventory/price-lookup', { ...options, params });
    return res.data;
  } catch (err) {
    throwNormalized(err, 'Failed to lookup effective price');
  }
};

export const getBranchStockConfig = async (params = {}, options = {}) => {
  try {
    const res = await apiClient.get('/api/v2/inventory/branch-stock-config', { ...options, params });
    return res.data;
  } catch (err) {
    throwNormalized(err, 'Failed to load branch stock mapping');
  }
};

export const saveBranchStockConfig = async (data, options = {}) => {
  try {
    const payload = { ...data, branchId: data?.branchId || data?.serviceZoneId };
    const res = await apiClient.post('/api/v2/inventory/branch-stock-config', payload, options);
    return res.data;
  } catch (err) {
    throwNormalized(err, 'Failed to save branch stock mapping');
  }
};

export const postOpeningBalances = async (data, options = {}) => {
  try {
    const payload = {
      ...data,
      branchId: data?.branchId || data?.serviceZoneId,
      cashOnHand: toNum(data?.cashOnHand || 0),
      bankTransfers: toNum(data?.bankTransfers || 0),
      bankPOS: toNum(data?.bankPOS || 0),
      inventoryValue: toNum(data?.inventoryValue || 0),
      accountsReceivable: toNum(data?.accountsReceivable || 0),
      accountsPayable: toNum(data?.accountsPayable || 0),
    };
    const res = await apiClient.post('/api/v2/inventory/opening-balances', payload, options);
    return res.data;
  } catch (err) {
    throwNormalized(err, 'Failed to post opening balances');
  }
};

export const getCogsReadiness = async (params = {}, options = {}) => {
  try {
    const res = await apiClient.get('/api/v2/inventory/cogs-readiness', { ...options, params });
    return res.data;
  } catch (err) {
    throwNormalized(err, 'Failed to load COGS readiness');
  }
};

export const activateCogs = async (data, options = {}) => {
  try {
    const payload = { ...data, branchId: data?.branchId || data?.serviceZoneId };
    const res = await apiClient.post('/api/v2/inventory/cogs-activation', payload, options);
    return res.data;
  } catch (err) {
    throwNormalized(err, 'Failed to activate COGS');
  }
};


export const loadOpeningCylinderStock = async (data, options = {}) => {
  try {
    const payload = { ...data, branchId: data?.branchId || data?.serviceZoneId };
    const res = await apiClient.post('/api/v2/inventory/opening-cylinders', payload, options);
    return res.data;
  } catch (err) {
    throwNormalized(err, 'Failed to load opening cylinder stock');
  }
};
