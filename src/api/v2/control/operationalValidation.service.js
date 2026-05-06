// src/api/v2/control/operationalValidation.service.js
const mongoose = require('mongoose');
const HttpError = require('../../../utils/HttpError');
const Plant = require('../../../models/plant.model');
const StockIn = require('../../../models/stockIn.model');
const BranchStockConfig = require('../../../models/branchStockConfig.model');
const BranchPrice = require('../../../models/branchPrice.model');
const AccountingPeriod = require('../../../models/accountingPeriod.model');
const StockMovement = require('../../../models/stockMovement.model');
const LpgProduct = require('../../../models/lpgProduct.model');
const { resolveBranchIdentity } = require('../utils/branchIdentity');

const hasVal = (v) => v !== undefined && v !== null && String(v).trim() !== '';
const toNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const parseDate = (v) => {
  if (!v) return new Date();
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const periodKey = (dateLike) => {
  const d = parseDate(dateLike);
  if (!d) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const objectOrStringMatch = (field, value) => {
  const s = String(value || '');
  const ors = [{ [field]: s }];
  if (mongoose.Types.ObjectId.isValid(s)) ors.push({ [field]: new mongoose.Types.ObjectId(s) });
  return { $or: ors };
};

const findPlantByAnyId = async (branchId) => {
  if (!hasVal(branchId)) return null;
  const identity = await resolveBranchIdentity(branchId);
  return identity.plant || null;
};

const assertOpenPeriod = async (dateLike, actionLabel = 'perform this action') => {
  const key = periodKey(dateLike);
  if (!key) throw new HttpError(400, 'Business date is invalid.');
  const period = await AccountingPeriod.findOne({ periodKey: key }).lean();
  if (period && String(period.status).toUpperCase() === 'LOCKED') {
    throw new HttpError(400, `Cannot ${actionLabel}; accounting period ${key} is locked.`);
  }
  return { periodKey: key, period };
};

const assertValidPlant = async (branchId, { requireOperational = true } = {}) => {
  if (!hasVal(branchId)) throw new HttpError(400, 'branchId / plantId is required.');
  const plant = await findPlantByAnyId(branchId);
  if (!plant) throw new HttpError(400, `Plant/branch not found for id: ${branchId}.`);
  if (requireOperational && ['Offline'].includes(String(plant.status || ''))) {
    throw new HttpError(400, `Plant ${plant.name || branchId} is Offline. Change plant status before posting operational records.`);
  }
  return plant;
};

const assertBranchStockMapping = async (branchId) => {
  const identity = await resolveBranchIdentity(branchId);
  const aliases = identity.aliases.length ? identity.aliases : [String(branchId)];
  const cfg = await BranchStockConfig.findOne({ branchId: { $in: aliases }, isActive: true }).lean();
  if (!cfg) throw new HttpError(400, 'Plant-to-stock mapping is missing. Configure Branch Stock Config before logging stock or sales.');
  if (!hasVal(cfg.stockLocationId)) throw new HttpError(400, 'Plant-to-stock mapping is incomplete: stockLocationId is required.');
  return cfg;
};

const getAvailableStockKg = async (branchId) => {
  const identity = await resolveBranchIdentity(branchId);
  const aliases = identity.aliases.length ? identity.aliases : [String(branchId)];
  const rows = await StockIn.aggregate([
    { $match: { branchId: { $in: aliases } } },
    { $group: { _id: null, availableKg: { $sum: '$remainingKg' }, totalStockedKg: { $sum: '$quantityKg' } } },
  ]);
  return {
    availableKg: toNum(rows[0]?.availableKg, 0),
    totalStockedKg: toNum(rows[0]?.totalStockedKg, 0),
  };
};

const assertStockInitialized = async (branchId) => {
  const stock = await getAvailableStockKg(branchId);
  if (stock.totalStockedKg <= 0) {
    throw new HttpError(400, 'Stock has not been logged for this plant. Load opening stock or stock-in before logging sales.');
  }
  return stock;
};

const assertStockAvailable = async (branchId, qtyKg) => {
  const qty = toNum(qtyKg, 0);
  if (qty <= 0) throw new HttpError(400, 'Quantity/kg sold must be greater than zero.');
  const stock = await assertStockInitialized(branchId);
  if (stock.availableKg + 0.0001 < qty) {
    throw new HttpError(400, `Insufficient LPG stock. Available: ${stock.availableKg}kg; requested: ${qty}kg.`);
  }
  return stock;
};

const assertEffectivePriceExists = async ({ branchId, productId, productSku, businessDate }) => {
  const dt = parseDate(businessDate) || new Date();
  const identity = await resolveBranchIdentity(branchId);
  const aliases = identity.aliases.length ? identity.aliases : [String(branchId)];
  const q = {
    branchId: { $in: aliases },
    status: 'ACTIVE',
    effectiveStartDate: { $lte: dt },
    $or: [{ effectiveEndDate: null }, { effectiveEndDate: { $gte: dt } }],
  };
  if (productId || productSku) {
    q.$and = [{ $or: [{ productId: String(productId || productSku) }, { productSku: String(productSku || productId) }] }];
  }
  const price = await BranchPrice.findOne(q).sort({ effectiveStartDate: -1, createdAt: -1 }).lean();
  if (!price) {
    const product = productId || productSku || 'default LPG product';
    throw new HttpError(400, `No active effective branch price exists for ${product}. Configure product/branch pricing before logging sales.`);
  }
  return price;
};

const assertActiveProduct = async (productIdOrSku) => {
  if (!hasVal(productIdOrSku)) return null;
  const key = String(productIdOrSku);
  const q = { $or: [{ id: key }, { sku: key }, { _id: mongoose.Types.ObjectId.isValid(key) ? new mongoose.Types.ObjectId(key) : undefined }].filter((x) => Object.values(x)[0] !== undefined) };
  const product = await LpgProduct.findOne(q).lean();
  if (!product) throw new HttpError(400, `Product not found: ${key}.`);
  if (product.isActive === false) throw new HttpError(400, `Product ${product.name || key} is inactive.`);
  return product;
};

const validatePosSaleBeforeLog = async ({ branchId, productId, productSku, kgSold, pricePerKg, amount, paymentMethod, businessDate }) => {
  const date = parseDate(businessDate) || new Date();
  const plant = await assertValidPlant(branchId, { requireOperational: true });
  await assertOpenPeriod(date, 'log a POS sale');
  await assertBranchStockMapping(branchId);
  const product = await assertActiveProduct(productId || productSku).catch((err) => {
    if (productId || productSku) throw err;
    return null;
  });
  const stock = await assertStockAvailable(branchId, kgSold);
  const price = await assertEffectivePriceExists({ branchId, productId: product?.id || productId, productSku: product?.sku || productSku, businessDate: date });
  if (toNum(pricePerKg, 0) <= 0) throw new HttpError(400, 'pricePerKg must be greater than zero.');
  if (toNum(amount, 0) <= 0) throw new HttpError(400, 'Sale amount/totalRevenue must be greater than zero.');
  const pm = String(paymentMethod || '').toUpperCase();
  if (!['CASH', 'TRANSFER', 'POS'].includes(pm)) throw new HttpError(400, 'paymentMethod must be CASH, TRANSFER or POS.');
  return { plant, stock, price, product };
};

const validateStockInBeforeLog = async ({ branchId, quantityKg, costPerKg, supplier, purchaseDate, reference }) => {
  const date = parseDate(purchaseDate) || new Date();
  const plant = await assertValidPlant(branchId, { requireOperational: false });
  await assertOpenPeriod(date, 'log stock-in');
  const cfg = await assertBranchStockMapping(branchId);
  const qty = toNum(quantityKg, 0);
  const cost = toNum(costPerKg, 0);
  if (qty <= 0) throw new HttpError(400, 'quantityKg must be greater than zero.');
  if (cost <= 0) throw new HttpError(400, 'costPerKg must be greater than zero.');
  if (!hasVal(supplier)) throw new HttpError(400, 'supplier is required for stock-in.');
  if (hasVal(reference)) {
    const identity = await resolveBranchIdentity(branchId);
    const aliases = identity.aliases.length ? identity.aliases : [String(branchId)];
    const duplicate = await StockIn.findOne({ branchId: { $in: aliases }, $or: [{ supplierInvoiceRef: String(reference) }, { reference: String(reference) }] }).lean().catch(() => null);
    if (duplicate) throw new HttpError(409, 'Duplicate stock-in reference detected for this plant.');
  }
  return { plant, cfg };
};

const getPlantControlSnapshot = async (branchId) => {
  const identity = await resolveBranchIdentity(branchId);
  const aliases = identity.aliases.length ? identity.aliases : [String(branchId)];
  const [plant, cfg, stock, lastMovement] = await Promise.all([
    findPlantByAnyId(branchId),
    BranchStockConfig.findOne({ branchId: { $in: aliases } }).lean(),
    getAvailableStockKg(branchId),
    StockMovement.findOne({ branchId: { $in: aliases } }).sort({ movementDate: -1, createdAt: -1 }).lean(),
  ]);
  return { plant, stockConfig: cfg, stock, lastMovement };
};

module.exports = {
  hasVal,
  toNum,
  parseDate,
  periodKey,
  findPlantByAnyId,
  assertOpenPeriod,
  assertValidPlant,
  assertBranchStockMapping,
  assertStockInitialized,
  assertStockAvailable,
  assertEffectivePriceExists,
  validatePosSaleBeforeLog,
  validateStockInBeforeLog,
  getAvailableStockKg,
  getPlantControlSnapshot,
};
