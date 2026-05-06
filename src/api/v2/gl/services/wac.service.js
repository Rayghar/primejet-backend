// File: src/api/v2/gl/services/wac.service.js
//
// Purpose (GL-first):
// Compute Weighted Average Cost (WAC) per kg for LPG as-of a business date,
// per branch (branchKey = String(branchId/serviceZoneId/zoneId/plantId)).
//
// This is used by posting handlers when posting COGS:
//   COGS = kgSold × WAC(asOf business date)
//
// Data source:
//   StockIn collection (purchaseDate, quantityKg, costPerKg)
//   - We ONLY trust purchaseDate as the business date for inventory purchases.
//   - createdAt is NOT used (migration-safe).
//
// IMPORTANT MIGRATION NOTE:
// If your historical StockIn is incomplete for early months,
// WAC may be 0. Posting handlers should either:
//   - skip COGS posting when WAC=0 (recommended), OR
//   - post COGS later via adjustment journals once stock data is complete.
//
// Exports:
//   - getWacCostPerKgAsOf(branchKey, asOfDate)
//   - getWacSnapshot(branchKey, startDate, endDate)  (optional diagnostics)
//   - clearWacCache()

const mongoose = require('mongoose');
const StockIn = require('../../../../models/stockIn.model');
const { resolveBranchIdentity } = require('../../utils/branchIdentity');

// -------------------------
// helpers
// -------------------------
const safeNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const toDate = (d) => {
  const x = d ? new Date(d) : null;
  return x && !Number.isNaN(x.getTime()) ? x : null;
};

const endOfDay = (d) => {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
};

const asBranchOrZoneMatch = async (branchKey) => {
  if (!branchKey) return {};
  const identity = await resolveBranchIdentity(branchKey);
  const aliases = identity.aliases.length ? identity.aliases : [String(branchKey)];
  return { branchId: { $in: aliases } };
};

// -------------------------
// WAC cache (small, safe)
// -------------------------
const _cache = new Map();
/**
 * Cache key: `${branchKey || 'ALL'}|${YYYY-MM-DD}`
 * Value: { wac, totalKg, totalCost, computedAtMs }
 */
const CACHE_TTL_MS = 60_000; // 60s is enough for UI/posting bursts

const _cacheKey = (branchKey, asOfDate) => {
  const d = new Date(asOfDate);
  const keyDate = Number.isNaN(d.getTime()) ? 'INVALID' : d.toISOString().slice(0, 10);
  return `${branchKey ? String(branchKey) : 'ALL'}|${keyDate}`;
};

const clearWacCache = () => _cache.clear();

// -------------------------
// Core: compute WAC as-of date
// -------------------------
const getWacCostPerKgAsOf = async (branchKey, asOfDate) => {
  const asOf = toDate(asOfDate);
  if (!asOf) {
    const e = new Error('Invalid asOfDate for WAC');
    e.code = 'WAC_BAD_DATE';
    throw e;
  }
  const end = endOfDay(asOf);

  const ck = _cacheKey(branchKey, end);
  const cached = _cache.get(ck);
  if (cached && Date.now() - cached.computedAtMs < CACHE_TTL_MS) {
    return {
      wac: cached.wac,
      totalKg: cached.totalKg,
      totalCost: cached.totalCost,
      asOf: end,
      cached: true,
    };
  }

  const branchMatch = await asBranchOrZoneMatch(branchKey);
  const match = {
    ...branchMatch,
    purchaseDate: { $lte: end },
  };

  // IMPORTANT: We only include batches with valid qty and cost
  const rows = await StockIn.find(match).select('quantityKg costPerKg purchaseDate').lean();

  let totalKg = 0;
  let totalCost = 0;

  for (const b of rows || []) {
    const q = safeNum(b?.quantityKg, 0);
    const c = safeNum(b?.costPerKg, 0);
    if (q > 0 && c > 0) {
      totalKg += q;
      totalCost += q * c;
    }
  }

  const wac = totalKg > 0 ? totalCost / totalKg : 0;

  _cache.set(ck, {
    wac,
    totalKg,
    totalCost,
    computedAtMs: Date.now(),
  });

  return { wac, totalKg, totalCost, asOf: end, cached: false };
};

// -------------------------
// Diagnostics: WAC snapshot across a date range
// -------------------------
/**
 * getWacSnapshot
 * Returns WAC values at month boundaries (or daily if short range),
 * to help you validate migration and cost behavior.
 */
const getWacSnapshot = async (branchKey, startDate, endDate) => {
  const start = toDate(startDate);
  const end = toDate(endDate);
  if (!start || !end) {
    const e = new Error('Invalid startDate/endDate for WAC snapshot');
    e.code = 'WAC_BAD_DATES';
    throw e;
  }
  const endIncl = endOfDay(end);

  const days = Math.ceil((endIncl.getTime() - start.getTime()) / (24 * 3600 * 1000));
  const points = [];

  // If range <= 45 days, snapshot daily; else snapshot monthly.
  if (days <= 45) {
    for (let i = 0; i <= days; i += 1) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      // eslint-disable-next-line no-await-in-loop
      const r = await getWacCostPerKgAsOf(branchKey, d);
      points.push({ date: d.toISOString().slice(0, 10), wac: safeNum(r.wac, 0) });
    }
  } else {
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cursor <= endIncl) {
      // eslint-disable-next-line no-await-in-loop
      const r = await getWacCostPerKgAsOf(branchKey, cursor);
      points.push({ date: cursor.toISOString().slice(0, 10), wac: safeNum(r.wac, 0) });
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }

  return {
    branchId: branchKey ? String(branchKey) : null,
    period: { start, end: endIncl },
    points,
  };
};

module.exports = {
  getWacCostPerKgAsOf,
  getWacSnapshot,
  clearWacCache,
};