// src/api/v2/inventory/services/productPricing.service.js
const LpgProduct = require('../../../../models/lpgProduct.model');
const BranchPrice = require('../../../../models/branchPrice.model');
const BranchStockConfig = require('../../../../models/branchStockConfig.model');
const StockIn = require('../../../../models/stockIn.model');
const DailySummary = require('../../../../models/dailySummary.model');
const { resolveBranchIdentity } = require('../../utils/branchIdentity');

const safeNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const parseDate = (v) => {
  if (!v) return new Date();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? new Date() : d;
};

const getDefaultProduct = async () => {
  let product = await LpgProduct.findOne({ sku: 'BULK-LPG-KG' });
  if (!product) {
    product = await LpgProduct.create({
      sku: 'BULK-LPG-KG',
      name: 'Bulk LPG Per KG',
      productType: 'BULK_LPG',
      unitOfMeasure: 'KG',
      defaultKg: 1,
      defaultSellingPrice: 0,
      costingMethod: 'WAC',
      isLpg: true,
      isActive: true,
      createdBy: 'system',
    });
  }
  return product;
};

const lookupEffectivePrice = async ({ branchId, productId, productSku, businessDate }) => {
  const product = productId
    ? await LpgProduct.findOne({ $or: [{ id: productId }, { _id: productId }, { sku: String(productId).toUpperCase() }] }).lean().catch(() => null)
    : productSku
      ? await LpgProduct.findOne({ sku: String(productSku).toUpperCase() }).lean()
      : await getDefaultProduct();

  const p = product || await getDefaultProduct();
  const dt = parseDate(businessDate);
  const identity = await resolveBranchIdentity(branchId);
  const aliases = identity.aliases.length ? identity.aliases : [String(branchId || '')].filter(Boolean);
  const effective = await BranchPrice.findOne({
    branchId: aliases.length ? { $in: aliases } : String(branchId || ''),
    productId: String(p.id || p._id),
    status: 'ACTIVE',
    effectiveStartDate: { $lte: dt },
    $or: [{ effectiveEndDate: null }, { effectiveEndDate: { $gte: dt } }],
  }).sort({ effectiveStartDate: -1, createdAt: -1 }).lean();

  return {
    product: p,
    productId: String(p.id || p._id),
    productSku: p.sku,
    productName: p.name,
    pricePerKg: safeNum(effective?.pricePerKg, safeNum(p.defaultSellingPrice, 0)),
    fixedPrice: safeNum(effective?.fixedPrice, 0),
    effectivePrice: effective || null,
    source: effective ? 'BRANCH_PRICE' : 'PRODUCT_DEFAULT',
    businessDate: dt,
  };
};

const computeCogsReadiness = async ({ branchId }) => {
  const qBranch = branchId ? String(branchId) : null;
  const identity = qBranch ? await resolveBranchIdentity(qBranch) : { aliases: [], objectIds: [] };
  const aliases = identity.aliases.length ? identity.aliases : (qBranch ? [qBranch] : []);
  const config = qBranch ? await BranchStockConfig.findOne({ branchId: { $in: aliases } }).lean() : null;
  const stockFilter = qBranch ? { branchId: { $in: aliases } } : {};
  const stockCount = await StockIn.countDocuments(stockFilter);
  const pricedStockCount = await StockIn.countDocuments({ ...stockFilter, costPerKg: { $gt: 0 }, remainingKg: { $gte: 0 } });
  const remainingRows = await StockIn.aggregate([
    { $match: stockFilter },
    { $group: { _id: null, remainingKg: { $sum: '$remainingKg' }, value: { $sum: { $multiply: ['$remainingKg', '$costPerKg'] } } } },
  ]);
  const remainingKg = safeNum(remainingRows[0]?.remainingKg, 0);
  const value = safeNum(remainingRows[0]?.value, 0);
  const wac = remainingKg > 0 ? value / remainingKg : 0;
  const products = await LpgProduct.countDocuments({ isActive: true, isLpg: true });
  const priceCount = qBranch ? await BranchPrice.countDocuments({ branchId: { $in: aliases }, status: 'ACTIVE' }) : 0;
  const unresolvedSummaries = qBranch
    ? await DailySummary.countDocuments({ ...(identity.objectIds.length ? { branchId: { $in: identity.objectIds } } : { _id: { $exists: false } }), status: { $in: ['in_progress', 'pending_approval', 'rejected'] } }).catch(() => 0)
    : 0;

  const controls = [
    { key: 'branch_stock_config', passed: Boolean(config), message: config ? 'Branch stock mapping exists.' : 'Branch stock location mapping is missing.' },
    { key: 'opening_or_stock_in', passed: stockCount > 0, message: stockCount > 0 ? `${stockCount} stock batch(es) found.` : 'No opening stock or stock-in records found.' },
    { key: 'cost_basis', passed: pricedStockCount > 0 && wac > 0, message: wac > 0 ? `WAC available at ${wac.toFixed(2)}.` : 'No usable WAC/cost basis found.' },
    { key: 'lpg_product_config', passed: products > 0, message: products > 0 ? `${products} active LPG product(s) found.` : 'No active LPG product configured.' },
    { key: 'branch_price_config', passed: priceCount > 0, message: priceCount > 0 ? `${priceCount} active branch price row(s) found.` : 'No active branch price configured.' },
    { key: 'no_unresolved_prior_closes', passed: unresolvedSummaries === 0, warning: unresolvedSummaries > 0, message: unresolvedSummaries === 0 ? 'No unresolved daily close for this branch.' : `${unresolvedSummaries} unresolved daily close item(s) exist.` },
  ];
  const mandatory = controls.filter((c) => ['branch_stock_config', 'opening_or_stock_in', 'cost_basis', 'lpg_product_config'].includes(c.key));
  const ready = mandatory.every((c) => c.passed);
  return { ready, cogsEnabled: Boolean(config?.cogsEnabled), remainingKg, wac, stockValue: value, config, controls };
};

module.exports = { getDefaultProduct, lookupEffectivePrice, computeCogsReadiness };
