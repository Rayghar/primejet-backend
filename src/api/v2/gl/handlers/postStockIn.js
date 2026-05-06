// src/api/v2/gl/handlers/postStockIn.js
const mongoose = require('mongoose');
const StockIn = require('../../../../models/stockIn.model');
const MigrationStagingRecord = require('../../../../models/migrationStagingRecord.model');
const { upsertJournal } = require('../services/journalUpsert.service');
const { DEFAULT_ACCOUNTS } = require('../services/coaMapping.service');

const safeNum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const parseDate = (d) => { const x = d ? new Date(d) : null; return x && !Number.isNaN(x.getTime()) ? x : null; };
const toBranchKey = (doc) => { const v = doc?.branchId ?? doc?.serviceZoneId ?? doc?.zoneId ?? doc?.plantId ?? doc?.branchKey ?? null; return v == null ? null : String(v); };
const isOpeningStock = (stock) => String(stock?.stockType || stock?.type || '').toUpperCase() === 'OPENING_STOCK';
const norm = (v) => (v === undefined || v === null ? '' : String(v).trim().toUpperCase());
const lc = (v) => (v === undefined || v === null ? '' : String(v).trim().toLowerCase());

const paymentSignals = (stock) => {
  const amountPaid = safeNum(stock?.amountPaid ?? stock?.paidAmount, 0);
  const ps = lc(stock?.paymentStatus || '');
  const explicitlyPaid = stock?.isPaid === true || ['paid', 'settled', 'completed', 'success', 'successful'].includes(ps);
  const hasSignals = ['amountPaid', 'paidAmount', 'isPaid', 'paymentStatus'].some((k) => Object.prototype.hasOwnProperty.call(stock || {}, k));
  return { amountPaid, explicitlyPaid, hasSignals };
};

const paymentCreditAccount = (stock, opts = {}) => {
  if (norm(opts.forceStockFundingAccount) === 'BANK') return DEFAULT_ACCOUNTS.BANK_TRANSFERS;
  const pm = lc(stock?.paymentMethod || stock?.mode || stock?.paymentMode || '');
  if (pm.includes('cash')) return DEFAULT_ACCOUNTS.CASH_ON_HAND;
  if (pm.includes('pos') || pm.includes('card')) return DEFAULT_ACCOUNTS.BANK_POS;
  return DEFAULT_ACCOUNTS.BANK_TRANSFERS;
};

const getMigrationStockSource = async (stock) => {
  const id = stock?._id ? String(stock._id) : null;
  if (!id) return null;
  try {
    return await MigrationStagingRecord.findOne({
      recordType: { $in: ['OPENING_STOCK', 'STOCK_PURCHASE'] },
      importedModel: 'StockIn',
      importedId: id,
      importStatus: 'IMPORTED',
    }).select('recordType batchId sourceSheet sourceRowNumber normalized rawRow duplicateKey').lean();
  } catch (_) {
    return null;
  }
};

const isHistoricalMigrationStockPurchase = ({ stock, staging }) => {
  if (isOpeningStock(stock)) return false;
  if (staging?.recordType === 'STOCK_PURCHASE') return true;
  const stockType = norm(stock?.stockType || stock?.type || '');
  const treatment = norm(stock?.glFundingTreatment);
  // Legacy migration safety: the earlier importer marked historical stock purchases
  // as glFundingTreatment=OPENING_EQUITY. Treat those PURCHASE rows as historical
  // stock purchases even if the staging record lookup is unavailable.
  if (stockType === 'PURCHASE' && treatment === 'OPENING_EQUITY') return true;
  return Boolean(stock?.migrationBatchId || stock?.importBatchId || stock?.migrationSourceRowNumber);
};

const getHistoricalStockFundingMode = (opts = {}) => {
  const raw = norm(opts.historicalStockFundingMode || opts.stockFundingMode || process.env.GL_HISTORICAL_STOCK_FUNDING_MODE || 'BANK');
  if (['BANK', 'OPENING_EQUITY', 'ACCOUNTS_PAYABLE'].includes(raw)) return raw;
  return 'BANK';
};

const getHistoricalCogsMode = (opts = {}) => {
  const raw = norm(opts.historicalCogsMode || process.env.GL_HISTORICAL_COGS_MODE || 'STOCK_PURCHASE_FULL_COST');
  if (['STOCK_PURCHASE_FULL_COST', 'STOCK_PURCHASES_FULL_COST', 'PURCHASE_FULL_COST', 'PURCHASES_FULL_COST'].includes(raw)) return 'STOCK_PURCHASE_FULL_COST';
  if (['DAILY_SALES_WAC', 'OPERATIONAL_WAC', 'WAC'].includes(raw)) return 'DAILY_SALES_WAC';
  if (['NONE', 'DISABLED', 'OFF'].includes(raw)) return 'NONE';
  return 'STOCK_PURCHASE_FULL_COST';
};

const shouldPostHistoricalCogsFromStock = ({ stock, staging, opts = {} }) => {
  if (getHistoricalCogsMode(opts) !== 'STOCK_PURCHASE_FULL_COST') return false;
  return isOpeningStock(stock) || isHistoricalMigrationStockPurchase({ stock, staging });
};

const fundingCreditLines = ({ stock, total, staging, opts = {} }) => {
  if (isOpeningStock(stock)) {
    return [{ accountCode: DEFAULT_ACCOUNTS.OPENING_BALANCE_EQUITY || '3200', debit: 0, credit: total, narration: 'Opening LPG stock funded by opening equity' }];
  }

  const treatment = norm(stock?.glFundingTreatment);
  const historicalMigrationPurchase = isHistoricalMigrationStockPurchase({ stock, staging });

  if (historicalMigrationPurchase) {
    // Important production fix: older migrations saved stock purchases with
    // glFundingTreatment=OPENING_EQUITY. That was wrong for subsequent stock.
    // Only opening stock is equity-funded. Historical STOCK_PURCHASE rows must
    // follow the rebuild policy, defaulting to BANK.
    const mode = getHistoricalStockFundingMode(opts);
    if (mode === 'OPENING_EQUITY') {
      return [{ accountCode: DEFAULT_ACCOUNTS.OPENING_BALANCE_EQUITY || '3200', debit: 0, credit: total, narration: 'Historical stock purchase funded through opening equity override' }];
    }
    if (mode === 'ACCOUNTS_PAYABLE') {
      return [{ accountCode: DEFAULT_ACCOUNTS.ACCOUNTS_PAYABLE, debit: 0, credit: total, narration: 'Historical stock purchase supplier payable override' }];
    }
    return [{ accountCode: DEFAULT_ACCOUNTS.BANK_TRANSFERS, debit: 0, credit: total, narration: 'Historical stock purchase paid from bank (Option C)' }];
  }

  if (treatment === 'OPENING_EQUITY') {
    return [{ accountCode: DEFAULT_ACCOUNTS.OPENING_BALANCE_EQUITY || '3200', debit: 0, credit: total, narration: 'Stock purchase explicitly funded by opening equity override' }];
  }
  if (treatment === 'ACCOUNTS_PAYABLE') {
    return [{ accountCode: DEFAULT_ACCOUNTS.ACCOUNTS_PAYABLE, debit: 0, credit: total, narration: 'Supplier payable' }];
  }
  if (treatment === 'BANK') {
    return [{ accountCode: DEFAULT_ACCOUNTS.BANK_TRANSFERS, debit: 0, credit: total, narration: 'Stock purchase paid from bank' }];
  }

  const sig = paymentSignals(stock);
  if (sig.hasSignals && sig.explicitlyPaid) {
    return [{ accountCode: paymentCreditAccount(stock, opts), debit: 0, credit: total, narration: 'Stock purchase paid' }];
  }
  if (sig.hasSignals && sig.amountPaid > 0 && sig.amountPaid < total) {
    return [
      { accountCode: paymentCreditAccount(stock, opts), debit: 0, credit: sig.amountPaid, narration: 'Paid portion of stock purchase' },
      { accountCode: DEFAULT_ACCOUNTS.ACCOUNTS_PAYABLE, debit: 0, credit: total - sig.amountPaid, narration: 'Outstanding supplier payable' },
    ];
  }
  return [{ accountCode: DEFAULT_ACCOUNTS.ACCOUNTS_PAYABLE, debit: 0, credit: total, narration: 'Supplier payable' }];
};

async function postStockIn(stockOrId, opts = {}) {
  const stock = typeof stockOrId === 'string' || mongoose.Types.ObjectId.isValid(String(stockOrId)) ? await StockIn.findById(stockOrId).lean() : stockOrId;
  if (!stock) return { status: 'SKIPPED', reasonCode: 'STOCKIN_NOT_FOUND', message: 'Stock-in was not found' };
  const businessDate = parseDate(stock.purchaseDate);
  if (!businessDate) return { status: 'SKIPPED', reasonCode: 'STOCKIN_INVALID_PURCHASE_DATE', message: 'Stock-in has invalid purchase date' };
  const branchKey = toBranchKey(stock);
  if (!branchKey) return { status: 'SKIPPED', reasonCode: 'STOCKIN_MISSING_BRANCH', message: 'Stock-in has no branch key' };
  const qty = safeNum(stock.quantityKg, 0);
  const costPerKg = safeNum(stock.costPerKg, 0);
  if (qty <= 0 || costPerKg <= 0) return { status: 'SKIPPED', reasonCode: 'STOCKIN_INVALID_QTY_OR_COST', message: 'Quantity/cost is invalid' };

  const staging = await getMigrationStockSource(stock);
  const total = qty * costPerKg;
  const historicalMigrationPurchase = isHistoricalMigrationStockPurchase({ stock, staging });
  const creditLines = fundingCreditLines({ stock, total, staging, opts });
  const lines = [
    { accountCode: DEFAULT_ACCOUNTS.INVENTORY_LPG, debit: total, credit: 0, narration: isOpeningStock(stock) ? 'Opening LPG stock' : 'LPG inventory receipt' },
    ...creditLines,
  ];

  const postHistoricalCogs = shouldPostHistoricalCogsFromStock({ stock, staging, opts });
  if (postHistoricalCogs) {
    // Historical migration COGS source of truth: 02_opening_stock + 03_stock_purchases.
    // Do not use DailySummary kg/WAC for historical COGS because daily sales already
    // carries expected revenue and variance. This prevents over-depleting inventory.
    lines.push({ accountCode: DEFAULT_ACCOUNTS.COGS_LPG, debit: total, credit: 0, narration: isOpeningStock(stock) ? 'Historical COGS from opening LPG stock' : 'Historical COGS from stock purchase cost' });
    lines.push({ accountCode: DEFAULT_ACCOUNTS.INVENTORY_LPG, debit: 0, credit: total, narration: isOpeningStock(stock) ? 'Release opening stock cost to historical COGS' : 'Release purchased stock cost to historical COGS' });
  }

  const creditAccounts = creditLines.filter((l) => safeNum(l.credit, 0) > 0).map((l) => l.accountCode);
  const stockFundingTreatment = isOpeningStock(stock)
    ? 'OPENING_STOCK_TO_OPENING_EQUITY'
    : historicalMigrationPurchase
      ? `HISTORICAL_PURCHASE_${getHistoricalStockFundingMode(opts)}`
      : (stock?.glFundingTreatment || 'AUTO');

  if (opts.dryRun) {
    return {
      status: 'POSTED',
      glEntryIds: [],
      message: historicalMigrationPurchase
        ? `Dry run: historical migrated stock purchase will credit ${creditAccounts.join(', ')} under Option C/bank-centric policy.`
        : 'Dry run: stock-in journal is valid',
      meta: { historicalMigrationPurchase, stagingRecordType: staging?.recordType || null, creditAccounts, stockFundingTreatment, historicalCogsMode: getHistoricalCogsMode(opts), postHistoricalCogs },
    };
  }

  try {
    const result = await upsertJournal({
      date: businessDate,
      branchKey,
      sourceType: isOpeningStock(stock) ? 'OPENING_STOCK' : 'STOCK_IN',
      sourceId: String(stock._id),
      entryType: opts.entryType || 'PRIMARY',
      narration: `${isOpeningStock(stock) ? 'Opening stock' : 'Stock-in'} ${String(stock._id)} - ${qty}kg @ ${costPerKg}`,
      lines,
      meta: {
        stockInId: stock.id || null,
        quantityKg: qty,
        costPerKg,
        postingBatchId: opts.postingBatchId || null,
        historicalMigrationPurchase,
        migrationRecordType: staging?.recordType || null,
        migrationBatchId: staging?.batchId || null,
        migrationSourceSheet: staging?.sourceSheet || null,
        migrationSourceRowNumber: staging?.sourceRowNumber || null,
        stockFundingTreatment,
        historicalCogsMode: getHistoricalCogsMode(opts),
        postHistoricalCogs,
        accountingPolicy: opts.accountingPolicy || 'OPTION_C_BANK_CENTRIC_WORKING_CAPITAL',
      },
    });
    return { status: 'POSTED', glEntryIds: result.glEntryIds, message: 'Stock-in posted to GL' };
  } catch (e) {
    return { status: 'FAILED', reasonCode: e.code || 'STOCKIN_POSTING_FAILED', message: e.message || 'Stock-in posting failed' };
  }
}

module.exports = postStockIn;
module.exports.post = postStockIn;
module.exports.postStockIn = postStockIn;
