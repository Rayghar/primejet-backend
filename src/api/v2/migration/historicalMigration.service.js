const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const MigrationBatch = require('../../../models/migrationBatch.model');
const MigrationStagingRecord = require('../../../models/migrationStagingRecord.model');
const Plant = require('../../../models/plant.model');
const DailySummary = require('../../../models/dailySummary.model');
const SaleTransaction = require('../../../models/saleTransaction.model');
const ExpenseTransaction = require('../../../models/expenseTransaction.model');
const StockIn = require('../../../models/stockIn.model');
const StockMovement = require('../../../models/stockMovement.model');
const HttpError = require('../../../utils/HttpError');
const { depleteStockForDailySummary, recordStockInMovement, getSystemStockKg } = require('../inventory/services/stockLedger.service');

const RECORD_TYPES = {
  branches: 'BRANCH',
  openingStock: 'OPENING_STOCK',
  stockPurchases: 'STOCK_PURCHASE',
  dailySales: 'DAILY_SALE',
  expenses: 'EXPENSE',
  stockVariances: 'STOCK_VARIANCE',
};

const TEMPLATE = {
  branches: [
    'Branch Code', 'Branch Name', 'Plant Name', 'Location', 'Opening Date', 'Status', 'Capacity KG', 'Manager', 'Default Cashier', 'Notes',
  ],
  openingStock: [
    'Branch Code', 'Stock Date', 'Product', 'Opening Quantity KG', 'Opening Cost Per KG', 'Opening Total Cost', 'Target Sale Price Per KG', 'Source Reference', 'Notes',
  ],
  stockPurchases: [
    'Purchase Date', 'Branch Code', 'Supplier', 'Product', 'Quantity KG', 'Cost Per KG', 'Transport Cost', 'Other Landing Cost', 'Total Cost', 'Effective Landed Cost Per KG', 'Target Sale Price Per KG', 'Payment Method', 'Amount Paid', 'Reference', 'Notes',
  ],
  dailySales: [
    'Business Date', 'Branch Code', 'Cashier Name', 'Opening Meter A', 'Closing Meter A', 'Opening Meter B', 'Closing Meter B', 'Total KG Sold', 'Selling Price Per KG', 'Expected Revenue', 'Cash Amount', 'POS Amount', 'Bank Transfer Amount', 'Company Account Amount', 'Total Collected', 'Shortage / Overpayment', 'Notes', 'Raw Source Text',
  ],
  expenses: [
    'Expense Date', 'Branch Code', 'Cashier Name', 'Expense Category', 'Expense Description', 'Amount', 'Payment Source', 'Linked Business Date', 'Receipt Available', 'Notes',
  ],
  stockVariances: [
    'Variance Date', 'Branch Code', 'Product', 'Variance Type', 'Quantity KG', 'Estimated Cost Per KG', 'Estimated Value', 'Reason', 'Linked Business Date', 'Approved By', 'Notes',
  ],
};

const hasVal = (v) => v !== undefined && v !== null && String(v).trim() !== '';
const strip = (v) => String(v ?? '').trim();
const normalizeKey = (key) => String(key || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
const get = (row, keys, fallback = '') => {
  if (!row) return fallback;
  const direct = keys.find((k) => Object.prototype.hasOwnProperty.call(row, k));
  if (direct !== undefined) return row[direct];
  const map = new Map(Object.keys(row).map((k) => [normalizeKey(k), k]));
  for (const k of keys) {
    const real = map.get(normalizeKey(k));
    if (real !== undefined) return row[real];
  }
  return fallback;
};
const toNumber = (v, d = null) => {
  if (!hasVal(v)) return d;
  const n = Number(String(v).replace(/[₦,\s]/g, '').replace(/kg$/i, ''));
  return Number.isFinite(n) ? n : d;
};
const normalizeDateKey = (date) => date.toISOString().slice(0, 10);
const parseBusinessDate = (value, label = 'Business Date') => {
  if (!hasVal(value)) throw new Error(`${label} is required; upload date must never be used as transaction date.`);
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 0, 0, 0, 0));
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const epoch = Date.UTC(1899, 11, 30);
    const d = new Date(epoch + value * 86400000);
    if (!Number.isNaN(d.getTime())) return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
  }
  const s = String(value).trim();
  let d = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, day] = s.split('-').map(Number);
    d = new Date(Date.UTC(y, m - 1, day, 0, 0, 0, 0));
  } else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    const [a, b, y] = s.split('/').map(Number);
    d = new Date(Date.UTC(y, b - 1, a, 0, 0, 0, 0));
  } else {
    const maybe = new Date(s);
    if (!Number.isNaN(maybe.getTime())) d = new Date(Date.UTC(maybe.getUTCFullYear(), maybe.getUTCMonth(), maybe.getUTCDate(), 0, 0, 0, 0));
  }
  if (!d || Number.isNaN(d.getTime())) throw new Error(`${label} is invalid: ${value}`);
  return d;
};
const inRange = (date, startDate, endDate) => {
  if (!date) return false;
  if (startDate && date < startDate) return false;
  if (endDate && date > endDate) return false;
  return true;
};
const normStatus = (v) => {
  const s = strip(v) || 'Operational';
  if (/maintenance/i.test(s)) return 'Maintenance';
  if (/offline|closed/i.test(s)) return 'Offline';
  if (/warn/i.test(s)) return 'Warning';
  return 'Operational';
};
const normalizeExpenseCategory = (value) => {
  const s = strip(value).toUpperCase();
  if (/FUEL|PETROL|DIESEL/.test(s)) return 'FUEL';
  if (/GENERATOR|MAINT|REPAIR|PLUG/.test(s)) return 'MAINTENANCE';
  if (/BIKE|DISPATCH|TRANSPORT|LOGISTICS/.test(s)) return 'LOGISTICS';
  if (/SALAR/.test(s)) return 'SALARIES';
  if (/UTILITY|POWER|ELECTRIC/.test(s)) return 'UTILITIES';
  if (/MARKET/.test(s)) return 'MARKETING';
  if (/ADMIN/.test(s)) return 'ADMIN';
  return 'MISCELLANEOUS';
};
const normalizePaymentDisposition = (value) => {
  const s = strip(value).toUpperCase();
  if (/POS/.test(s)) return 'POS';
  if (/BANK|TRANSFER|COMPANY/.test(s)) return 'TRANSFER';
  if (/UNPAID|PAYABLE|AP/.test(s)) return 'PAYABLE';
  return 'CASH';
};
const resolveBranch = async ({ branchCode, branchName }) => {
  const code = strip(branchCode);
  const name = strip(branchName);
  const q = { $or: [] };
  if (code) q.$or.push({ id: code }, { name: code });
  if (name) q.$or.push({ name });
  if (mongoose.Types.ObjectId.isValid(code)) q.$or.push({ _id: new mongoose.Types.ObjectId(code) });
  if (!q.$or.length) return null;
  return Plant.findOne(q).lean();
};

const normalizeBranchRow = (row) => {
  const openingDate = hasVal(get(row, ['Opening Date', 'openDate'])) ? parseBusinessDate(get(row, ['Opening Date', 'openDate']), 'Opening Date') : null;
  const branchCode = strip(get(row, ['Branch Code', 'Code', 'BranchCode']));
  const plantName = strip(get(row, ['Plant Name', 'Branch Name', 'Name']));
  const branchName = strip(get(row, ['Branch Name', 'Plant Name', 'Name'])) || plantName;
  return {
    branchCode,
    branchName,
    plantName: plantName || branchName,
    location: strip(get(row, ['Location', 'Address'])),
    openingDate,
    status: normStatus(get(row, ['Status'])),
    capacityKg: toNumber(get(row, ['Capacity KG', 'Capacity']), 0) || 0,
    manager: strip(get(row, ['Manager'])),
    defaultCashier: strip(get(row, ['Default Cashier', 'Cashier'])),
    notes: strip(get(row, ['Notes'])),
  };
};
const normalizeOpeningStockRow = (row) => {
  const stockDate = parseBusinessDate(get(row, ['Stock Date', 'Opening Stock Date', 'Business Date']), 'Stock Date');
  const qty = toNumber(get(row, ['Opening Quantity KG', 'Quantity KG', 'Qty KG']), 0);
  const cost = toNumber(get(row, ['Opening Cost Per KG', 'Cost Per KG', 'Unit Cost']), 0);
  return {
    branchCode: strip(get(row, ['Branch Code'])),
    stockDate,
    product: strip(get(row, ['Product'])) || 'LPG',
    quantityKg: qty,
    costPerKg: cost,
    openingTotalCost: toNumber(get(row, ['Opening Total Cost', 'Total Cost']), qty * cost),
    targetSalePricePerKg: toNumber(get(row, ['Target Sale Price Per KG', 'Selling Price Per KG']), Math.max(cost, 0.01)),
    sourceReference: strip(get(row, ['Source Reference', 'Reference'])),
    notes: strip(get(row, ['Notes'])),
  };
};
const normalizeStockPurchaseRow = (row) => {
  const purchaseDate = parseBusinessDate(get(row, ['Purchase Date', 'Stock Date', 'Business Date']), 'Purchase Date');
  const qty = toNumber(get(row, ['Quantity KG', 'Qty KG']), 0);
  const baseCost = toNumber(get(row, ['Cost Per KG', 'Unit Cost']), 0);
  const transport = toNumber(get(row, ['Transport Cost']), 0) || 0;
  const other = toNumber(get(row, ['Other Landing Cost', 'Other Cost']), 0) || 0;
  const totalCost = toNumber(get(row, ['Total Cost']), qty * baseCost + transport + other);
  const effective = toNumber(get(row, ['Effective Landed Cost Per KG', 'Landed Cost Per KG']), qty > 0 ? totalCost / qty : baseCost);
  return {
    purchaseDate,
    branchCode: strip(get(row, ['Branch Code'])),
    supplier: strip(get(row, ['Supplier'])) || 'Historical supplier',
    product: strip(get(row, ['Product'])) || 'LPG',
    quantityKg: qty,
    costPerKg: effective || baseCost,
    baseCostPerKg: baseCost,
    transportCost: transport,
    otherLandingCost: other,
    totalCost,
    targetSalePricePerKg: toNumber(get(row, ['Target Sale Price Per KG', 'Selling Price Per KG']), Math.max(effective || baseCost, 0.01)),
    paymentMethod: strip(get(row, ['Payment Method'])),
    amountPaid: toNumber(get(row, ['Amount Paid', 'Paid Amount']), totalCost),
    reference: strip(get(row, ['Reference', 'Invoice Reference', 'Supplier Invoice'])),
    notes: strip(get(row, ['Notes'])),
  };
};
const normalizeDailySaleRow = (row) => {
  const businessDate = parseBusinessDate(get(row, ['Business Date', 'Date', 'Sale Date']), 'Business Date');
  const openingA = toNumber(get(row, ['Opening Meter A']), 0) || 0;
  const closingA = toNumber(get(row, ['Closing Meter A']), 0) || 0;
  const openingB = toNumber(get(row, ['Opening Meter B']), 0) || 0;
  const closingB = toNumber(get(row, ['Closing Meter B']), 0) || 0;
  const meterKg = Math.max(0, closingA - openingA) + Math.max(0, closingB - openingB);
  const kg = toNumber(get(row, ['Total KG Sold', 'KG Sold', 'Quantity KG']), meterKg);
  const price = toNumber(get(row, ['Selling Price Per KG', 'Price Per KG', 'Unit Price']), 0);
  const expected = toNumber(get(row, ['Expected Revenue', 'Total Revenue']), kg * price);
  const cashAmount = toNumber(get(row, ['Cash Amount', 'Cash']), 0) || 0;
  const posAmount = toNumber(get(row, ['POS Amount', 'POS']), 0) || 0;
  const bank = toNumber(get(row, ['Bank Transfer Amount', 'Transfer Amount']), null);
  const company = toNumber(get(row, ['Company Account Amount', 'Company Transfer Amount']), null);
  const explicitTransfer = (bank || 0) + (company || 0);
  const explicitTotalCollected = toNumber(get(row, ['Total Collected', 'Total Amount', 'Collected Amount']), null);

  // IMPORTANT MIGRATION CONTROL:
  // If the CSV already states Total Collected, do NOT manufacture a missing transfer
  // from Expected Revenue - Cash - POS. That difference is a tender shortage/overage
  // and must be posted to Cash Over / Short, not to Bank - Transfers.
  // Only derive transfer as a fallback when the source row does not provide either
  // transfer/company-account values or a Total Collected amount.
  const shouldDeriveTransfer = explicitTransfer <= 0 && explicitTotalCollected === null;
  const derivedTransfer = shouldDeriveTransfer ? Math.max(0, (expected || 0) - cashAmount - posAmount) : 0;
  const transferAmount = explicitTransfer > 0 ? explicitTransfer : derivedTransfer;
  const totalCollected = explicitTotalCollected !== null ? explicitTotalCollected : cashAmount + posAmount + transferAmount;
  return {
    businessDate,
    branchCode: strip(get(row, ['Branch Code'])),
    cashierName: strip(get(row, ['Cashier Name', 'Cashier'])) || 'Migration Cashier',
    openingMeterA: openingA,
    closingMeterA: closingA,
    openingMeterB: openingB,
    closingMeterB: closingB,
    meterKg,
    totalKgSold: kg,
    sellingPricePerKg: price,
    expectedRevenue: expected,
    cashAmount,
    posAmount,
    bankTransferAmount: bank || 0,
    companyAccountAmount: company || 0,
    transferAmount,
    totalCollected,
    shortageOverpayment: toNumber(get(row, ['Shortage / Overpayment', 'Shortage', 'Variance']), totalCollected - expected),
    notes: strip(get(row, ['Notes'])),
    rawSourceText: strip(get(row, ['Raw Source Text'])),
  };
};
const normalizeExpenseRow = (row) => {
  const expenseDate = parseBusinessDate(get(row, ['Expense Date', 'Date']), 'Expense Date');
  return {
    expenseDate,
    branchCode: strip(get(row, ['Branch Code'])),
    cashierName: strip(get(row, ['Cashier Name', 'Cashier'])) || 'Migration Cashier',
    category: normalizeExpenseCategory(get(row, ['Expense Category', 'Category'])),
    description: strip(get(row, ['Expense Description', 'Description'])) || 'Historical expense',
    amount: toNumber(get(row, ['Amount', 'Expense Amount']), 0),
    paymentSource: normalizePaymentDisposition(get(row, ['Payment Source', 'Payment Method'])),
    linkedBusinessDate: hasVal(get(row, ['Linked Business Date', 'Business Date'])) ? parseBusinessDate(get(row, ['Linked Business Date', 'Business Date']), 'Linked Business Date') : expenseDate,
    receiptAvailable: /^(yes|true|1)$/i.test(strip(get(row, ['Receipt Available']))),
    notes: strip(get(row, ['Notes'])),
  };
};
const normalizeStockVarianceRow = (row) => {
  const varianceDate = parseBusinessDate(get(row, ['Variance Date', 'Date']), 'Variance Date');
  const qty = Math.abs(toNumber(get(row, ['Quantity KG', 'Variance KG']), 0));
  const varianceTypeRaw = strip(get(row, ['Variance Type', 'Type']));
  const direction = /gain|excess|surplus|in/i.test(varianceTypeRaw) ? 'IN' : 'OUT';
  const cost = toNumber(get(row, ['Estimated Cost Per KG', 'Cost Per KG']), 0) || 0;
  return {
    varianceDate,
    branchCode: strip(get(row, ['Branch Code'])),
    product: strip(get(row, ['Product'])) || 'LPG',
    varianceType: varianceTypeRaw || 'Shortage/Loss',
    direction,
    quantityKg: qty,
    estimatedCostPerKg: cost,
    estimatedValue: toNumber(get(row, ['Estimated Value', 'Value']), qty * cost),
    reason: strip(get(row, ['Reason'])) || varianceTypeRaw || 'Historical stock variance',
    linkedBusinessDate: hasVal(get(row, ['Linked Business Date', 'Business Date'])) ? parseBusinessDate(get(row, ['Linked Business Date', 'Business Date']), 'Linked Business Date') : varianceDate,
    approvedBy: strip(get(row, ['Approved By'])),
    notes: strip(get(row, ['Notes'])),
  };
};

const normalizers = {
  BRANCH: normalizeBranchRow,
  OPENING_STOCK: normalizeOpeningStockRow,
  STOCK_PURCHASE: normalizeStockPurchaseRow,
  DAILY_SALE: normalizeDailySaleRow,
  EXPENSE: normalizeExpenseRow,
  STOCK_VARIANCE: normalizeStockVarianceRow,
};
const dateFieldByType = {
  BRANCH: 'openingDate',
  OPENING_STOCK: 'stockDate',
  STOCK_PURCHASE: 'purchaseDate',
  DAILY_SALE: 'businessDate',
  EXPENSE: 'expenseDate',
  STOCK_VARIANCE: 'varianceDate',
};

const branchNameFromBranchSheet = (payloadRows = []) => {
  const map = new Map();
  (payloadRows.branches || []).forEach((row) => {
    try {
      const n = normalizeBranchRow(row);
      if (n.branchCode) map.set(n.branchCode, n.branchName || n.plantName || n.branchCode);
    } catch (_) {}
  });
  return map;
};

const buildDuplicateKey = (recordType, n) => {
  const d = n[dateFieldByType[recordType]];
  const dateKey = d ? normalizeDateKey(d) : 'NO_DATE';
  if (recordType === 'BRANCH') return `BRANCH|${n.branchCode || n.branchName}`;
  if (recordType === 'OPENING_STOCK') return `OPENING_STOCK|${n.branchCode}|${dateKey}|${n.quantityKg}|${n.costPerKg}`;
  if (recordType === 'STOCK_PURCHASE') return `STOCK_PURCHASE|${n.branchCode}|${dateKey}|${n.supplier}|${n.quantityKg}|${n.reference || ''}`;
  if (recordType === 'DAILY_SALE') return `DAILY_SALE|${n.branchCode}|${dateKey}`;
  if (recordType === 'EXPENSE') return `EXPENSE|${n.branchCode}|${dateKey}|${n.description}|${n.amount}`;
  if (recordType === 'STOCK_VARIANCE') return `STOCK_VARIANCE|${n.branchCode}|${dateKey}|${n.reason}|${n.quantityKg}`;
  return `${recordType}|${uuidv4()}`;
};

const validateNormalized = async ({ recordType, normalized, batch, branchMap, sourceRowNumber }) => {
  const errors = [];
  const warnings = [];
  const dateField = dateFieldByType[recordType];
  const businessDate = normalized[dateField] || null;
  if (recordType !== 'BRANCH' && !businessDate) errors.push(`${dateField} is required; upload date cannot be used.`);
  if (businessDate && !inRange(businessDate, batch.dateRange?.startDate, batch.dateRange?.endDate)) warnings.push(`Date ${normalizeDateKey(businessDate)} is outside the selected batch date range.`);

  let branch = null;
  const branchCode = normalized.branchCode;
  if (recordType !== 'BRANCH') {
    if (!hasVal(branchCode)) errors.push('Branch Code is required.');
    branch = await resolveBranch({ branchCode, branchName: branchMap.get(branchCode) });
    if (!branch && !branchMap.has(branchCode)) errors.push(`Branch Code ${branchCode || '(blank)'} was not found and is not included in the Branches sheet.`);
    if (!branch && branchMap.has(branchCode)) warnings.push(`Branch ${branchCode} will be created before importing this record.`);
  }

  if (recordType === 'BRANCH') {
    if (!hasVal(normalized.branchCode) && !hasVal(normalized.branchName)) errors.push('Branch Code or Branch Name is required.');
  }
  if (['OPENING_STOCK', 'STOCK_PURCHASE'].includes(recordType)) {
    if (toNumber(normalized.quantityKg, 0) <= 0) errors.push('Quantity KG must be greater than zero.');
    if (toNumber(normalized.costPerKg, 0) <= 0) errors.push('Cost Per KG must be greater than zero.');
  }
  if (recordType === 'DAILY_SALE') {
    if (!hasVal(normalized.cashierName)) errors.push('Cashier Name is required.');
    if (toNumber(normalized.totalKgSold, 0) <= 0) errors.push('Total KG Sold must be greater than zero.');
    if (toNumber(normalized.sellingPricePerKg, 0) <= 0) errors.push('Selling Price Per KG must be greater than zero.');
    if (normalized.closingMeterA < normalized.openingMeterA) errors.push('Closing Meter A cannot be less than Opening Meter A.');
    if (normalized.closingMeterB < normalized.openingMeterB) errors.push('Closing Meter B cannot be less than Opening Meter B.');
    const expected = toNumber(normalized.expectedRevenue, 0);
    const calc = toNumber(normalized.totalKgSold, 0) * toNumber(normalized.sellingPricePerKg, 0);
    if (Math.abs(expected - calc) > Math.max(100, calc * 0.01)) warnings.push(`Expected revenue differs from KG × price by ${Number(expected - calc).toFixed(2)}.`);
    const split = toNumber(normalized.cashAmount, 0) + toNumber(normalized.posAmount, 0) + toNumber(normalized.transferAmount, 0);
    if (Math.abs(split - expected) > 100) warnings.push(`Cash + POS + transfer differs from expected revenue by ${Number(split - expected).toFixed(2)}.`);
    if (branch) {
      const existing = await DailySummary.findOne({ branchId: branch._id, businessDateKey: normalizeDateKey(normalized.businessDate) }).lean();
      if (existing) return { branch, status: 'DUPLICATE', errors, warnings: [`Daily summary already exists for ${branch.name} on ${normalizeDateKey(normalized.businessDate)}.`], duplicate: existing };
    }
  }
  if (recordType === 'EXPENSE') {
    if (toNumber(normalized.amount, 0) <= 0) errors.push('Expense amount must be greater than zero.');
    if (!hasVal(normalized.description)) errors.push('Expense description is required.');
  }
  if (recordType === 'STOCK_VARIANCE') {
    if (toNumber(normalized.quantityKg, 0) <= 0) errors.push('Variance quantity KG must be greater than zero.');
    if (!hasVal(normalized.reason)) errors.push('Variance reason is required.');
  }
  return {
    branch,
    status: errors.length ? 'BLOCKED' : warnings.length ? 'WARNING' : 'READY',
    errors,
    warnings,
    sourceRowNumber,
  };
};

const summarizeBatch = async (batchId) => {
  const rows = await MigrationStagingRecord.aggregate([
    { $match: { batchId } },
    { $group: { _id: { validationStatus: '$validationStatus', importStatus: '$importStatus' }, count: { $sum: 1 } } },
  ]);
  const totals = { records: 0, ready: 0, warnings: 0, blocked: 0, duplicates: 0, imported: 0, failed: 0 };
  rows.forEach((r) => {
    totals.records += r.count;
    if (r._id.validationStatus === 'READY') totals.ready += r.count;
    if (r._id.validationStatus === 'WARNING') totals.warnings += r.count;
    if (r._id.validationStatus === 'BLOCKED') totals.blocked += r.count;
    if (r._id.validationStatus === 'DUPLICATE') totals.duplicates += r.count;
    if (r._id.importStatus === 'IMPORTED') totals.imported += r.count;
    if (r._id.importStatus === 'FAILED') totals.failed += r.count;
  });
  await MigrationBatch.updateOne({ batchId }, { $set: { totals } });
  return totals;
};

const createBatch = async ({ name, dateRange = {}, rows = {}, options = {}, sourceFileName, user }) => {
  if (!hasVal(name)) throw new HttpError(400, 'Migration batch name is required.');
  const startDate = hasVal(dateRange.startDate) ? parseBusinessDate(dateRange.startDate, 'Batch start date') : null;
  const endDate = hasVal(dateRange.endDate) ? parseBusinessDate(dateRange.endDate, 'Batch end date') : null;
  const batch = await MigrationBatch.create({
    name: strip(name),
    sourceType: 'CSV_EXCEL',
    dateRange: { startDate, endDate },
    sourceFileName: sourceFileName || null,
    uploadedBy: user?.id || user?._id || 'system',
    uploadedByName: user?.name || user?.fullName || user?.email || 'System User',
    options: { ...(options || {}) },
  });

  const branchMap = branchNameFromBranchSheet(rows);
  const docs = [];
  for (const [sourceKey, recordType] of Object.entries(RECORD_TYPES)) {
    const list = Array.isArray(rows?.[sourceKey]) ? rows[sourceKey] : [];
    for (let idx = 0; idx < list.length; idx += 1) {
      const rawRow = list[idx] || {};
      const sourceRowNumber = idx + 2;
      let normalized = {};
      let validationStatus = 'READY';
      let validationErrors = [];
      let warnings = [];
      let branch = null;
      try {
        normalized = normalizers[recordType](rawRow);
        const check = await validateNormalized({ recordType, normalized, batch, branchMap, sourceRowNumber });
        validationStatus = check.status;
        validationErrors = check.errors;
        warnings = check.warnings;
        branch = check.branch;
      } catch (error) {
        validationStatus = 'BLOCKED';
        validationErrors = [error.message];
      }
      const dateField = dateFieldByType[recordType];
      docs.push({
        batchId: batch.batchId,
        recordType,
        sourceSheet: sourceKey,
        sourceRowNumber,
        rawRow,
        normalized,
        businessDate: normalized[dateField] || null,
        branchCode: normalized.branchCode || null,
        branchName: normalized.branchName || branchMap.get(normalized.branchCode) || null,
        branchObjectId: branch?._id || null,
        duplicateKey: buildDuplicateKey(recordType, normalized),
        validationStatus,
        validationErrors,
        warnings,
      });
    }
  }
  if (docs.length) await MigrationStagingRecord.insertMany(docs, { ordered: false });
  const totals = await summarizeBatch(batch.batchId);
  batch.status = totals.blocked > 0 || totals.duplicates > 0 || totals.warnings > 0 ? 'READY_FOR_REVIEW' : 'VALIDATED';
  batch.totals = totals;
  await batch.save();
  return getBatch(batch.batchId, { limit: 100 });
};

const getBatch = async (batchId, { limit = 200, status, type } = {}) => {
  const batch = await MigrationBatch.findOne({ batchId }).lean();
  if (!batch) throw new HttpError(404, 'Migration batch not found.');
  const q = { batchId };
  if (status) q.validationStatus = status;
  if (type) q.recordType = type;
  const staging = await MigrationStagingRecord.find(q).sort({ recordType: 1, sourceRowNumber: 1 }).limit(Math.min(Number(limit) || 200, 1000)).lean();
  return { batch, staging, count: staging.length };
};

const listBatches = async (query = {}) => {
  const limit = Math.min(Number(query.limit) || 50, 200);
  const rows = await MigrationBatch.find({}).sort({ createdAt: -1 }).limit(limit).lean();
  return { count: rows.length, items: rows };
};

const updateStagingRecord = async (id, payload = {}) => {
  const rec = await MigrationStagingRecord.findById(id);
  if (!rec) throw new HttpError(404, 'Staging record not found.');
  if (rec.importStatus === 'IMPORTED') throw new HttpError(400, 'Imported staging records cannot be edited.');
  const rawRow = { ...(rec.rawRow || {}), ...(payload.rawRow || payload) };
  let normalized = {};
  let validationStatus = 'READY';
  let validationErrors = [];
  let warnings = [];
  try {
    normalized = normalizers[rec.recordType](rawRow);
    const batch = await MigrationBatch.findOne({ batchId: rec.batchId });
    const branches = await MigrationStagingRecord.find({ batchId: rec.batchId, recordType: 'BRANCH' }).lean();
    const branchMap = new Map(branches.map((b) => [b.normalized?.branchCode, b.normalized?.branchName || b.normalized?.plantName || b.normalized?.branchCode]));
    const check = await validateNormalized({ recordType: rec.recordType, normalized, batch, branchMap, sourceRowNumber: rec.sourceRowNumber });
    validationStatus = check.status;
    validationErrors = check.errors;
    warnings = check.warnings;
    rec.branchObjectId = check.branch?._id || null;
  } catch (error) {
    validationStatus = 'BLOCKED';
    validationErrors = [error.message];
  }
  rec.rawRow = rawRow;
  rec.normalized = normalized;
  rec.businessDate = normalized[dateFieldByType[rec.recordType]] || null;
  rec.branchCode = normalized.branchCode || null;
  rec.branchName = normalized.branchName || rec.branchName || null;
  rec.duplicateKey = buildDuplicateKey(rec.recordType, normalized);
  rec.validationStatus = validationStatus;
  rec.validationErrors = validationErrors;
  rec.warnings = warnings;
  await rec.save();
  await summarizeBatch(rec.batchId);
  return rec.toObject();
};

const dryRun = async (batchId) => {
  const batch = await MigrationBatch.findOne({ batchId });
  if (!batch) throw new HttpError(404, 'Migration batch not found.');
  const rows = await MigrationStagingRecord.find({ batchId }).lean();
  const summary = {
    branchesToCreate: rows.filter((r) => r.recordType === 'BRANCH' && ['READY', 'WARNING'].includes(r.validationStatus)).length,
    openingStockToCreate: rows.filter((r) => r.recordType === 'OPENING_STOCK' && ['READY', 'WARNING'].includes(r.validationStatus)).length,
    stockPurchasesToCreate: rows.filter((r) => r.recordType === 'STOCK_PURCHASE' && ['READY', 'WARNING'].includes(r.validationStatus)).length,
    dailySummariesToCreate: rows.filter((r) => r.recordType === 'DAILY_SALE' && ['READY', 'WARNING'].includes(r.validationStatus)).length,
    expensesToCreate: rows.filter((r) => r.recordType === 'EXPENSE' && ['READY', 'WARNING'].includes(r.validationStatus)).length,
    stockVariancesToCreate: rows.filter((r) => r.recordType === 'STOCK_VARIANCE' && ['READY', 'WARNING'].includes(r.validationStatus)).length,
    blockedRows: rows.filter((r) => r.validationStatus === 'BLOCKED').length,
    duplicateRows: rows.filter((r) => r.validationStatus === 'DUPLICATE').length,
    totalRevenue: rows.filter((r) => r.recordType === 'DAILY_SALE').reduce((sum, r) => sum + toNumber(r.normalized?.expectedRevenue, 0), 0),
    totalKgSold: rows.filter((r) => r.recordType === 'DAILY_SALE').reduce((sum, r) => sum + toNumber(r.normalized?.totalKgSold, 0), 0),
    totalExpenses: rows.filter((r) => r.recordType === 'EXPENSE').reduce((sum, r) => sum + toNumber(r.normalized?.amount, 0), 0),
    stockInKg: rows.filter((r) => ['OPENING_STOCK', 'STOCK_PURCHASE'].includes(r.recordType)).reduce((sum, r) => sum + toNumber(r.normalized?.quantityKg, 0), 0),
    varianceKg: rows.filter((r) => r.recordType === 'STOCK_VARIANCE').reduce((sum, r) => sum + toNumber(r.normalized?.quantityKg, 0) * (r.normalized?.direction === 'IN' ? 1 : -1), 0),
    rule: 'All dates will come from the CSV business date columns only. Upload date is only audit metadata.',
  };
  batch.dryRun = { ranAt: new Date(), summary };
  batch.status = 'DRY_RUN_COMPLETE';
  await batch.save();
  return { batch: batch.toObject(), summary };
};

const ensureBranch = async (n, createdBy) => {
  const existing = await resolveBranch({ branchCode: n.branchCode, branchName: n.branchName || n.plantName });
  if (existing) return existing;
  const branch = await Plant.create({
    id: n.branchCode || uuidv4(),
    name: n.branchName || n.plantName || n.branchCode,
    capacity: toNumber(n.capacityKg, 0) || 10000,
    status: n.status || 'Operational',
    location: { address: n.location || '' },
    monthlyOpex: 0,
    targetDailyOutputKg: 1500,
  });
  return branch.toObject();
};

const ensureBranchFromCode = async (branchCode, branchMap, createdBy) => {
  let branch = await resolveBranch({ branchCode, branchName: branchMap.get(branchCode) });
  if (branch) return branch;
  if (!branchMap.has(branchCode)) throw new Error(`Branch ${branchCode} not found.`);
  branch = await Plant.create({ id: branchCode, name: branchMap.get(branchCode), capacity: 10000, status: 'Operational', monthlyOpex: 0, targetDailyOutputKg: 1500 });
  return branch.toObject();
};

const createSaleLines = async ({ summary, n, branch, userId }) => {
  const sales = [];
  const parts = [
    { method: 'CASH', amount: toNumber(n.cashAmount, 0) },
    { method: 'POS', amount: toNumber(n.posAmount, 0) },
    { method: 'TRANSFER', amount: toNumber(n.transferAmount, 0) },
  ].filter((p) => p.amount > 0);
  const total = parts.reduce((sum, p) => sum + p.amount, 0) || toNumber(n.expectedRevenue, 0);
  for (const p of parts) {
    const kgSold = total > 0 ? toNumber(n.totalKgSold, 0) * (p.amount / total) : 0;
    // eslint-disable-next-line no-await-in-loop
    const sale = await SaleTransaction.create({
      date: n.businessDate,
      branchId: branch._id,
      dailySummaryId: summary._id,
      productSku: 'LPG',
      productName: 'LPG',
      kgSold,
      pricePerKg: toNumber(n.sellingPricePerKg, 0),
      totalRevenue: p.amount,
      cashAmount: p.method === 'CASH' ? p.amount : 0,
      posAmount: p.method === 'POS' ? p.amount : 0,
      transferAmount: p.method === 'TRANSFER' ? p.amount : 0,
      paymentMethod: p.method,
      status: 'approved',
      cashierId: userId || 'migration',
      cashierName: n.cashierName || 'Migration Cashier',
      receiptNumber: `MIG-${normalizeDateKey(n.businessDate)}-${String(summary._id).slice(-6)}-${p.method}`,
    });
    sales.push(sale);
  }
  return sales;
};

const getOrCreateSummaryForDate = async ({ branch, date, cashierName, pricePerKg, userId }) => {
  const dateKey = normalizeDateKey(date);
  let summary = await DailySummary.findOne({ branchId: branch._id, businessDateKey: dateKey });
  if (summary) return summary;
  summary = await DailySummary.create({
    dailySummaryId: uuidv4(),
    date,
    branchId: branch._id,
    cashierName: cashierName || 'Migration Cashier',
    pricePerKg: Math.max(toNumber(pricePerKg, 0.01), 0.01),
    status: 'approved',
    openingMeters: { meterA: 0, meterB: 0 },
    closingMeters: { meterA: 0, meterB: 0 },
    createdBy: userId || 'migration',
    managerApproval: { isApproved: true, approvedBy: userId || 'migration', approvedAt: new Date(), approvalComment: 'Created by historical migration.' },
    finalizationControls: { meterReadingsConfirmed: true, salesReviewed: true, expensesReviewed: true, reconciliationReviewed: true, finalizedBy: userId || 'migration', finalizedAt: new Date() },
    posting: { status: 'UNPOSTED' },
  });
  return summary;
};

const importOne = async ({ rec, branchMap, userId, options }) => {
  const n = rec.normalized || {};
  if (!['READY', 'WARNING'].includes(rec.validationStatus)) return { skipped: true, reason: rec.validationStatus };
  if (rec.importStatus === 'IMPORTED') return { skipped: true, reason: 'ALREADY_IMPORTED' };
  if (rec.recordType === 'BRANCH') {
    const branch = await ensureBranch(n, userId);
    return { importedModel: 'Plant', importedId: String(branch._id) };
  }
  const branch = await ensureBranchFromCode(n.branchCode, branchMap, userId);
  if (rec.recordType === 'OPENING_STOCK') {
    const stock = await StockIn.create({
      branchId: String(branch._id),
      stockType: 'OPENING_STOCK',
      quantityKg: toNumber(n.quantityKg, 0),
      remainingKg: toNumber(n.quantityKg, 0),
      supplier: 'Opening stock migration',
      purchaseDate: n.stockDate,
      costPerKg: Math.max(toNumber(n.costPerKg, 0), 0.01),
      targetSalePricePerKg: Math.max(toNumber(n.targetSalePricePerKg, n.costPerKg), 0.01),
      amountPaid: toNumber(n.openingTotalCost, 0),
      paidAmount: toNumber(n.openingTotalCost, 0),
      isPaid: true,
      paymentStatus: 'PAID',
      paymentMethod: 'MIGRATION',
      glFundingTreatment: 'OPENING_EQUITY',
      loggedBy: { uid: userId || 'migration', email: 'migration@local' },
      posting: { status: 'UNPOSTED' },
    });
    await recordStockInMovement(stock, userId || 'migration');
    return { importedModel: 'StockIn', importedId: String(stock._id) };
  }
  if (rec.recordType === 'STOCK_PURCHASE') {
    const stock = await StockIn.create({
      branchId: String(branch._id),
      stockType: 'PURCHASE',
      quantityKg: toNumber(n.quantityKg, 0),
      remainingKg: toNumber(n.quantityKg, 0),
      supplier: n.supplier || 'Historical supplier',
      purchaseDate: n.purchaseDate,
      costPerKg: Math.max(toNumber(n.costPerKg, 0), 0.01),
      targetSalePricePerKg: Math.max(toNumber(n.targetSalePricePerKg, n.costPerKg), 0.01),
      amountPaid: toNumber(n.amountPaid, 0),
      paidAmount: toNumber(n.amountPaid, 0),
      isPaid: toNumber(n.amountPaid, 0) >= toNumber(n.totalCost, 0),
      paymentStatus: toNumber(n.amountPaid, 0) >= toNumber(n.totalCost, 0) ? 'PAID' : 'PARTIAL',
      paymentMethod: n.paymentMethod || 'MIGRATION',
      // Subsequent historical stock purchases are paid from operating bank/cash,
      // not owner equity. Only OPENING_STOCK is funded by Opening Balance Equity.
      glFundingTreatment: 'BANK',
      loggedBy: { uid: userId || 'migration', email: 'migration@local' },
      posting: { status: 'UNPOSTED' },
    });
    await recordStockInMovement(stock, userId || 'migration');
    return { importedModel: 'StockIn', importedId: String(stock._id) };
  }
  if (rec.recordType === 'DAILY_SALE') {
    let summary = await DailySummary.findOne({ branchId: branch._id, businessDateKey: normalizeDateKey(n.businessDate) });
    if (summary) return { skipped: true, reason: 'DUPLICATE_DAILY_SUMMARY' };
    const salesSplit = {
      cashAmount: toNumber(n.cashAmount, 0),
      posAmount: toNumber(n.posAmount, 0),
      transferAmount: toNumber(n.transferAmount, 0),
    };
    const expectedRevenue = toNumber(n.expectedRevenue, 0);
    summary = await DailySummary.create({
      dailySummaryId: uuidv4(),
      date: n.businessDate,
      branchId: branch._id,
      cashierName: n.cashierName || 'Migration Cashier',
      pricePerKg: Math.max(toNumber(n.sellingPricePerKg, 0), 0.01),
      status: 'approved',
      openingMeters: { meterA: toNumber(n.openingMeterA, 0), meterB: toNumber(n.openingMeterB, 0) },
      closingMeters: { meterA: toNumber(n.closingMeterA, 0), meterB: toNumber(n.closingMeterB, 0) },
      sales: { totalRevenue: expectedRevenue, totalKgSold: toNumber(n.totalKgSold, 0), ...salesSplit, items: [] },
      expenses: { total: 0, items: [] },
      reconciliation: { calculatedRevenue: toNumber(n.totalKgSold, 0) * toNumber(n.sellingPricePerKg, 0), discrepancy: expectedRevenue - (toNumber(n.totalKgSold, 0) * toNumber(n.sellingPricePerKg, 0)) },
      createdBy: userId || 'migration',
      managerApproval: { isApproved: true, approvedBy: userId || 'migration', approvedAt: new Date(), approvalComment: 'Approved by historical migration.' },
      finalizationControls: { meterReadingsConfirmed: true, salesReviewed: true, expensesReviewed: true, reconciliationReviewed: true, varianceAcknowledged: true, varianceReason: 'Historical migration', finalizedBy: userId || 'migration', finalizedAt: new Date() },
      posting: { status: options.queueForGlPosting ? 'QUEUED' : 'UNPOSTED' },
    });
    const lines = await createSaleLines({ summary, n, branch, userId });
    summary.sales.items = lines.map((x) => x._id);
    await summary.save();
    if (options.importStockDepletionMovements === true) {
      const depletion = await depleteStockForDailySummary(summary, { createdBy: userId || 'migration' });
      if (!depletion.ok && !options.allowHistoricalNegativeStock) throw new Error(`Stock depletion failed: ${depletion.reason || 'unknown'}`);
    }
    return { importedModel: 'DailySummary', importedId: String(summary._id) };
  }
  if (rec.recordType === 'EXPENSE') {
    const summary = await getOrCreateSummaryForDate({ branch, date: n.linkedBusinessDate || n.expenseDate, cashierName: n.cashierName || 'Migration Cashier', pricePerKg: 0.01, userId });
    const expense = await ExpenseTransaction.create({
      dailySummaryId: summary._id,
      branchId: String(branch._id),
      cashierId: userId || 'migration',
      cashierName: n.cashierName || summary.cashierName || 'Migration Cashier',
      category: normalizeExpenseCategory(n.category),
      paymentDisposition: normalizePaymentDisposition(n.paymentSource),
      description: n.description || 'Historical expense',
      amount: toNumber(n.amount, 0),
      date: n.expenseDate,
      status: 'approved',
      approvedBy: userId || 'migration',
      approvedAt: new Date(),
      posting: { status: options.queueForGlPosting ? 'QUEUED' : 'UNPOSTED' },
    });
    summary.expenses.total = toNumber(summary.expenses?.total, 0) + toNumber(n.amount, 0);
    summary.expenses.items.push(expense._id);
    await summary.save();
    return { importedModel: 'ExpenseTransaction', importedId: String(expense._id) };
  }
  if (rec.recordType === 'STOCK_VARIANCE') {
    const qty = toNumber(n.quantityKg, 0);
    const unitCost = toNumber(n.estimatedCostPerKg, 0);
    // Clarified GL policy: historical stock variance rows are derived from
    // expected-sales-vs-actual-collections. They are NOT an additional physical
    // inventory movement. Keep the StockMovement only as an auditable variance
    // source for GL reclassification; do not consume or create StockIn layers here.
    const snapshot = await getSystemStockKg(String(branch._id));
    const movement = await StockMovement.create({
      branchId: String(branch._id),
      movementDate: n.varianceDate,
      movementType: 'RECONCILIATION_VARIANCE',
      direction: n.direction || 'OUT',
      quantityKg: qty,
      unitCost,
      totalCost: qty * unitCost,
      runningQuantityKg: snapshot.currentQtyKg,
      runningValue: null,
      sourceType: 'MIGRATION_STOCK_VARIANCE',
      sourceId: String(rec._id),
      sourceRef: rec.duplicateKey,
      narration: n.reason || 'Historical stock variance',
      createdBy: userId || 'migration',
      meta: { batchId: rec.batchId, notes: n.notes, approvedBy: n.approvedBy },
    });
    return { importedModel: 'StockMovement', importedId: String(movement._id) };
  }
  return { skipped: true, reason: 'UNSUPPORTED_TYPE' };
};


const repairTenderSplitsFromStagingProgress = async ({ startDate, endDate, branchCode, dryRun = true, chunkSize = 25, onProgress = null } = {}) => {
  const match = { recordType: 'DAILY_SALE', importStatus: 'IMPORTED', importedModel: 'DailySummary', importedId: { $nin: [null, ''] } };
  if (startDate || endDate) match.businessDate = {};
  if (startDate) match.businessDate.$gte = parseBusinessDate(startDate, 'startDate');
  if (endDate) match.businessDate.$lte = parseBusinessDate(endDate, 'endDate');
  if (branchCode) match.branchCode = String(branchCode);

  const total = await MigrationStagingRecord.countDocuments(match);
  const result = { matchedRows: total, changed: 0, unchanged: 0, skipped: 0, examples: [] };
  let processedRows = 0;
  const emit = async (stage = 'RUNNING') => {
    if (typeof onProgress === 'function') {
      await onProgress({ stage, total, processedRows, result: { ...result, examples: result.examples.slice(0, 20) } });
    }
  };

  await emit('STARTED');
  const cursor = MigrationStagingRecord.find(match).sort({ businessDate: 1, sourceRowNumber: 1, _id: 1 }).lean().cursor();
  for await (const row of cursor) {
    const n = row.normalized || {};
    const id = row.importedId;
    if (!id || !mongoose.Types.ObjectId.isValid(String(id))) {
      result.skipped += 1;
      processedRows += 1;
      if (processedRows % chunkSize === 0 || processedRows === total) await emit('RUNNING');
      continue;
    }
    const summary = await DailySummary.findById(id);
    if (!summary) {
      result.skipped += 1;
      processedRows += 1;
      if (processedRows % chunkSize === 0 || processedRows === total) await emit('RUNNING');
      continue;
    }

    const expectedRevenue = toNumber(n.expectedRevenue, 0);
    const cashAmount = toNumber(n.cashAmount, 0);
    const posAmount = toNumber(n.posAmount, 0);
    // Explicit migration rule: bank transfer + company account only. Do not manufacture transfer from shortages/overages.
    const transferAmount = toNumber(n.bankTransferAmount, 0) + toNumber(n.companyAccountAmount, 0);
    const collected = cashAmount + posAmount + transferAmount;
    const shortageOverpayment = collected - expectedRevenue;

    const before = {
      totalRevenue: toNumber(summary.sales?.totalRevenue, 0),
      cashAmount: toNumber(summary.sales?.cashAmount, 0),
      posAmount: toNumber(summary.sales?.posAmount, 0),
      transferAmount: toNumber(summary.sales?.transferAmount, 0),
    };
    const after = { totalRevenue: expectedRevenue, cashAmount, posAmount, transferAmount };
    const changed = Math.abs(before.totalRevenue - after.totalRevenue) > 0.01 || Math.abs(before.cashAmount - after.cashAmount) > 0.01 || Math.abs(before.posAmount - after.posAmount) > 0.01 || Math.abs(before.transferAmount - after.transferAmount) > 0.01;
    if (!changed) {
      result.unchanged += 1;
    } else {
      result.changed += 1;
      if (result.examples.length < 20) result.examples.push({ dailySummaryId: String(summary._id), businessDate: summary.businessDateKey, branchCode: row.branchCode || n.branchCode || null, before, after, shortageOverpayment });

      if (!dryRun) {
        summary.sales.totalRevenue = expectedRevenue;
        summary.sales.cashAmount = cashAmount;
        summary.sales.posAmount = posAmount;
        summary.sales.transferAmount = transferAmount;
        summary.reconciliation = summary.reconciliation || {};
        summary.reconciliation.discrepancy = shortageOverpayment;
        summary.posting = summary.posting || {};
        summary.posting.status = 'UNPOSTED';
        summary.posting.glEntryId = null;
        summary.posting.glEntryIds = [];
        summary.posting.errorCode = null;
        summary.posting.errorMessage = 'Tender split repaired from migration source. Rebuild GL required.';
        await summary.save();
      }
    }

    processedRows += 1;
    if (processedRows % chunkSize === 0 || processedRows === total) await emit('RUNNING');
  }
  result.dryRun = Boolean(dryRun);
  result.note = 'This repair uses MigrationStagingRecord.normalized cash/POS/bank transfer/company-account fields. It does not derive transfer from Expected Revenue - Cash - POS.';
  await emit('COMPLETED');
  return result;
};

const repairTenderSplitsFromStaging = async (params = {}) => repairTenderSplitsFromStagingProgress(params);

const importBatch = async (batchId, { user, includeWarnings = true } = {}) => {
  const batch = await MigrationBatch.findOne({ batchId });
  if (!batch) throw new HttpError(404, 'Migration batch not found.');
  await MigrationBatch.updateOne({ batchId }, { $set: { status: 'IMPORTING' } });
  const branchRows = await MigrationStagingRecord.find({ batchId, recordType: 'BRANCH' }).lean();
  const branchMap = new Map(branchRows.map((b) => [b.normalized?.branchCode, b.normalized?.branchName || b.normalized?.plantName || b.normalized?.branchCode]));
  const allowedStatuses = includeWarnings ? ['READY', 'WARNING'] : ['READY'];
  const rows = await MigrationStagingRecord.find({ batchId, validationStatus: { $in: allowedStatuses }, importStatus: { $ne: 'IMPORTED' } }).sort({ recordType: 1, businessDate: 1, sourceRowNumber: 1 });
  const order = { BRANCH: 1, OPENING_STOCK: 2, STOCK_PURCHASE: 3, DAILY_SALE: 4, EXPENSE: 5, STOCK_VARIANCE: 6 };
  rows.sort((a, b) => (order[a.recordType] || 99) - (order[b.recordType] || 99));

  const userId = user?.id || user?._id || 'migration';
  const result = { imported: 0, failed: 0, skipped: 0, failures: [], skippedRows: [] };
  for (const rec of rows) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const out = await importOne({ rec, branchMap, userId, options: batch.options || {} });
      if (out.skipped) {
        rec.importStatus = 'SKIPPED';
        rec.importError = out.reason || 'Skipped';
        result.skipped += 1;
        result.skippedRows.push({ id: rec._id, recordType: rec.recordType, reason: out.reason });
      } else {
        rec.importStatus = 'IMPORTED';
        rec.importedModel = out.importedModel;
        rec.importedId = out.importedId;
        result.imported += 1;
      }
      // eslint-disable-next-line no-await-in-loop
      await rec.save();
    } catch (error) {
      rec.importStatus = 'FAILED';
      rec.importError = error.message;
      result.failed += 1;
      result.failures.push({ id: rec._id, recordType: rec.recordType, row: rec.sourceRowNumber, error: error.message });
      // eslint-disable-next-line no-await-in-loop
      await rec.save();
    }
  }
  const totals = await summarizeBatch(batchId);
  const finalStatus = result.failed > 0 || totals.blocked > 0 || totals.duplicates > 0 ? 'PARTIALLY_IMPORTED' : 'IMPORTED';
  await MigrationBatch.updateOne({ batchId }, { $set: { status: finalStatus, importSummary: result } });
  return { batchId, status: finalStatus, result, totals: await summarizeBatch(batchId) };
};

module.exports = {
  TEMPLATE,
  createBatch,
  getBatch,
  listBatches,
  updateStagingRecord,
  dryRun,
  importBatch,
  repairTenderSplitsFromStaging,
  repairTenderSplitsFromStagingProgress,
};
