// File: src/api/v2/gl/handlers/postDailySummaryPOS.js
// Posts approved DailySummary POS sales to GL as one daily aggregated journal.

const mongoose = require('mongoose');
const DailySummary = require('../../../../models/dailySummary.model');
const StockMovement = require('../../../../models/stockMovement.model');
const BranchStockConfig = require('../../../../models/branchStockConfig.model');
const { upsertJournal } = require('../services/journalUpsert.service');
const {
  getRevenueAccountPOS,
  getCashOverShortAccount,
  DEFAULT_ACCOUNTS,
} = require('../services/coaMapping.service');
const { getWacCostPerKgAsOf } = require('../services/wac.service');
const { resolveBranchIdentity } = require('../../utils/branchIdentity');

const safeNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const toISODate = (d) => {
  const x = d ? new Date(d) : null;
  return x && !Number.isNaN(x.getTime()) ? x : null;
};

const toBranchKey = (doc) => {
  const v = doc?.branchId ?? doc?.serviceZoneId ?? doc?.zoneId ?? doc?.plantId ?? doc?.branchKey ?? null;
  return v == null ? null : String(v);
};


const normalizeSettlementMode = (opts = {}) => {
  const raw = String(opts.settlementMode || opts.cashPosSettlementMode || process.env.GL_CASH_POS_SETTLEMENT_MODE || 'ACTUAL').trim().toUpperCase();
  if (['SAME_DAY', 'SAME-DAY', 'C1', 'HISTORICAL_SAME_DAY', 'BANK_CENTRIC_C1'].includes(raw)) return 'SAME_DAY';
  return 'ACTUAL';
};

const addSameDayBankSettlementLines = ({ lines, cash, pos, assumedCash = 0 }) => {
  const cashToDeposit = safeNum(cash, 0) > 0 ? safeNum(cash, 0) : safeNum(assumedCash, 0);
  const posToSettle = safeNum(pos, 0);
  if (cashToDeposit > 0) {
    lines.push({ accountCode: DEFAULT_ACCOUNTS.BANK_TRANSFERS, debit: cashToDeposit, credit: 0, narration: 'C1 same-day cash deposit to bank' });
    lines.push({ accountCode: DEFAULT_ACCOUNTS.CASH_ON_HAND, debit: 0, credit: cashToDeposit, narration: 'C1 same-day cash deposited from till' });
  }
  if (posToSettle > 0) {
    lines.push({ accountCode: DEFAULT_ACCOUNTS.BANK_TRANSFERS, debit: posToSettle, credit: 0, narration: 'C1 same-day POS settlement to bank' });
    lines.push({ accountCode: DEFAULT_ACCOUNTS.BANK_POS, debit: 0, credit: posToSettle, narration: 'C1 same-day POS clearing settled to bank' });
  }
  return { cashSettledToBank: cashToDeposit, posSettledToBank: posToSettle };
};


const normalizeHistoricalCogsMode = (opts = {}) => {
  const raw = String(opts.historicalCogsMode || process.env.GL_HISTORICAL_COGS_MODE || 'STOCK_PURCHASE_FULL_COST').trim().toUpperCase();
  if (['STOCK_PURCHASE_FULL_COST', 'STOCK_PURCHASES_FULL_COST', 'PURCHASE_FULL_COST', 'PURCHASES_FULL_COST'].includes(raw)) return 'STOCK_PURCHASE_FULL_COST';
  if (['DAILY_SALES_WAC', 'OPERATIONAL_WAC', 'WAC'].includes(raw)) return 'DAILY_SALES_WAC';
  if (['NONE', 'DISABLED', 'OFF'].includes(raw)) return 'NONE';
  return 'STOCK_PURCHASE_FULL_COST';
};


const getExistingDailySummaryCogs = async (ds) => {
  if (!ds?._id) return { cogsAmount: 0, kgSold: 0, source: 'NONE', movementId: null };
  const sourceId = String(ds._id);
  const movement = await StockMovement.findOne({
    sourceType: 'DAILY_SUMMARY',
    sourceId,
    movementType: 'SALE_DEPLETION',
    direction: 'OUT',
  }).lean().catch(() => null);

  if (!movement) return { cogsAmount: 0, kgSold: 0, source: 'NONE', movementId: null };
  return {
    cogsAmount: safeNum(movement.totalCost, 0),
    kgSold: safeNum(movement.quantityKg, 0),
    unitCost: safeNum(movement.unitCost, 0),
    source: 'STOCK_MOVEMENT_SALE_DEPLETION',
    movementId: String(movement._id),
    movementBusinessId: movement.movementId || null,
  };
};

const postDailySummaryPOS = async (dsOrId, opts = {}) => {
  const ds =
    typeof dsOrId === 'string' || mongoose.Types.ObjectId.isValid(String(dsOrId))
      ? await DailySummary.findById(dsOrId).lean()
      : dsOrId;

  if (!ds) return { status: 'SKIPPED', reasonCode: 'DAILY_NOT_FOUND', message: 'Daily summary was not found' };

  const businessDate = toISODate(ds.date);
  if (!businessDate) return { status: 'SKIPPED', reasonCode: 'DAILY_INVALID_DATE', message: 'Daily summary has no valid business date' };

  const branchKey = toBranchKey(ds);
  if (!branchKey) return { status: 'SKIPPED', reasonCode: 'DAILY_MISSING_BRANCH', message: 'Daily summary has no branch/plant key' };

  const status = String(ds.status || '').toLowerCase().trim();
  if (status !== 'approved') return { status: 'SKIPPED', reasonCode: 'DAILY_NOT_APPROVED', message: 'Daily summary is not approved' };

  const revenue = safeNum(ds?.sales?.totalRevenue, 0);
  if (revenue <= 0) return { status: 'SKIPPED', reasonCode: 'DAILY_ZERO_REVENUE', message: 'Daily summary has zero revenue' };

  const cash = safeNum(ds?.sales?.cashAmount, 0);
  const transfer = safeNum(ds?.sales?.transferAmount, 0);
  const pos = safeNum(ds?.sales?.posAmount, 0);
  const tenderTotal = cash + transfer + pos;
  const diff = revenue - tenderTotal;
  // Historical WhatsApp/POS migrations often have small tender differences from rounding or
  // partially recorded company-account transfers. Differences up to this amount are
  // posted to Cash Over/Short instead of failing the whole day. Larger differences
  // still fail and must be corrected at source.
  const tolerance = safeNum(opts.tenderTolerance, Number(process.env.GL_DAILY_TENDER_TOLERANCE || 500));
  const discrepancyApproved = Boolean(
    ds?.finalizationControls?.varianceAcknowledged ||
    ds?.managerApproval?.policyOverrideReason ||
    ds?.managerApproval?.approvalComment?.toLowerCase?.().includes('variance') ||
    ds?.posting?.tenderVarianceApproved
  );
  const allowApprovedTenderVariance = String(process.env.GL_ALLOW_APPROVED_TENDER_VARIANCE || 'true').toLowerCase() !== 'false';

  if (tenderTotal > 0 && Math.abs(diff) > tolerance && !(allowApprovedTenderVariance && discrepancyApproved)) {
    return {
      status: 'FAILED',
      reasonCode: 'DAILY_TENDER_MISMATCH',
      message: `DailySummary tender mismatch: revenue=${revenue}, tenderTotal=${tenderTotal}, diff=${diff}. Difference exceeds tolerance ${tolerance}. Correct the source, or approve the discrepancy to post the difference to Cash Over/Short.`,
    };
  }

  const lines = [];
  const settlementMode = normalizeSettlementMode(opts);
  let assumedCashForSettlement = 0;
  if (tenderTotal <= 0) {
    lines.push({ accountCode: DEFAULT_ACCOUNTS.CASH_ON_HAND, debit: revenue, credit: 0, narration: 'POS sale - assumed cash' });
    assumedCashForSettlement = revenue;
  } else {
    if (cash > 0) lines.push({ accountCode: DEFAULT_ACCOUNTS.CASH_ON_HAND, debit: cash, credit: 0, narration: 'POS sale - cash' });
    if (transfer > 0) lines.push({ accountCode: DEFAULT_ACCOUNTS.BANK_TRANSFERS, debit: transfer, credit: 0, narration: 'POS sale - bank transfer/company account' });
    if (pos > 0) lines.push({ accountCode: DEFAULT_ACCOUNTS.BANK_POS, debit: pos, credit: 0, narration: 'POS sale - POS settlement clearing' });

    if (Math.abs(diff) > 0 && (Math.abs(diff) <= tolerance || (allowApprovedTenderVariance && discrepancyApproved))) {
      lines.push({
        accountCode: getCashOverShortAccount(),
        debit: diff > 0 ? Math.abs(diff) : 0,
        credit: diff < 0 ? Math.abs(diff) : 0,
        narration: Math.abs(diff) > tolerance ? 'Approved tender variance - cash over/short' : 'Tender rounding / cash over-short',
      });
    }
  }

  lines.push({ accountCode: getRevenueAccountPOS(), debit: 0, credit: revenue, narration: 'LPG POS sales revenue' });

  // Option C/C1 historical bank-centric policy: cash and POS are assumed to have
  // been deposited/settled into the main bank account on the same business day.
  // For production C2, settlementMode=ACTUAL leaves Cash/POS as clearing balances
  // until the bank reconciliation/settlement module posts the actual deposits.
  const settlementMeta = settlementMode === 'SAME_DAY'
    ? addSameDayBankSettlementLines({ lines, cash, pos, assumedCash: assumedCashForSettlement })
    : { cashSettledToBank: 0, posSettledToBank: 0 };

  const kgSold = safeNum(ds?.sales?.totalKgSold, 0);
  const historicalCogsMode = normalizeHistoricalCogsMode(opts);
  let cogsMeta = { enabled: false, posted: false, reason: 'HISTORICAL_COGS_POSTED_FROM_OPENING_STOCK_AND_STOCK_PURCHASES', kgSold, wacCostPerKg: 0, cogsAmount: 0, source: historicalCogsMode };

  if (historicalCogsMode !== 'STOCK_PURCHASE_FULL_COST' && historicalCogsMode !== 'NONE') {
    const branchIdentity = await resolveBranchIdentity(branchKey);
    const branchAliases = branchIdentity.aliases.length ? branchIdentity.aliases : [String(branchKey)];
    const stockConfig = await BranchStockConfig.findOne({ branchId: { $in: branchAliases }, isActive: { $ne: false } }).lean().catch(() => null);

    // Operational mode only: use StockMovement/WAC COGS for live daily sales.
    // Historical rebuild mode deliberately skips this block to avoid double depletion.
    const movementCogs = await getExistingDailySummaryCogs(ds);
    const cogsEnabled = opts.forceCogs === true || Boolean(stockConfig?.cogsEnabled) || safeNum(movementCogs.cogsAmount, 0) > 0 || kgSold > 0;
    cogsMeta = { enabled: cogsEnabled, posted: false, reason: null, kgSold, wacCostPerKg: 0, cogsAmount: 0, source: 'NONE' };

    if (safeNum(movementCogs.cogsAmount, 0) > 0) {
      const cogsAmount = safeNum(movementCogs.cogsAmount, 0);
      cogsMeta = { enabled: true, posted: true, reason: null, kgSold: safeNum(movementCogs.kgSold, kgSold), wacCostPerKg: safeNum(movementCogs.unitCost, 0), cogsAmount, source: movementCogs.source, movementId: movementCogs.movementId, movementBusinessId: movementCogs.movementBusinessId };
      lines.push({ accountCode: DEFAULT_ACCOUNTS.COGS_LPG, debit: cogsAmount, credit: 0, narration: 'LPG cost of goods sold from StockMovement SALE_DEPLETION' });
      lines.push({ accountCode: DEFAULT_ACCOUNTS.INVENTORY_LPG, debit: 0, credit: cogsAmount, narration: 'Reduce LPG inventory for POS sales from StockMovement SALE_DEPLETION' });
    } else if (!cogsEnabled) {
      cogsMeta.reason = 'NO_STOCK_MOVEMENT_AND_COGS_NOT_ACTIVATED_FOR_BRANCH';
    } else if (kgSold > 0) {
      try {
        const wac = await getWacCostPerKgAsOf(branchKey, businessDate);
        const wacCostPerKg = safeNum(wac?.wac, 0);
        const cogsAmount = kgSold * wacCostPerKg;
        cogsMeta = { enabled: true, posted: cogsAmount > 0, reason: cogsAmount > 0 ? null : 'WAC_ZERO_OR_STOCK_NOT_LOADED', kgSold, wacCostPerKg, cogsAmount, source: 'WAC_FALLBACK' };
        if (cogsAmount > 0) {
          lines.push({ accountCode: DEFAULT_ACCOUNTS.COGS_LPG, debit: cogsAmount, credit: 0, narration: 'LPG cost of goods sold - WAC fallback' });
          lines.push({ accountCode: DEFAULT_ACCOUNTS.INVENTORY_LPG, debit: 0, credit: cogsAmount, narration: 'Reduce LPG inventory for POS sales - WAC fallback' });
        }
      } catch (e) {
        cogsMeta = { enabled: true, posted: false, reason: e.code || e.message || 'WAC_ERROR', kgSold, wacCostPerKg: 0, cogsAmount: 0, source: 'WAC_FALLBACK' };
      }
    } else {
      cogsMeta.reason = 'NO_KG_SOLD';
    }
  }

  if (opts.dryRun) {
    return { status: 'POSTED', glEntryIds: [], message: 'Dry run: Daily Summary POS journal is valid' };
  }

  try {
    const sourceId = String(ds._id);
    const result = await upsertJournal({
      date: businessDate,
      branchKey,
      sourceType: 'DAILY_SUMMARY',
      sourceId,
      entryType: opts.entryType || 'PRIMARY',
      narration: `POS DailySummary ${sourceId}`,
      lines,
      meta: { dailySummaryId: ds.dailySummaryId || null, cashierName: ds.cashierName || null, postingBatchId: opts.postingBatchId || null, tender: { revenue, tenderTotal, difference: diff, tolerance, discrepancyApproved }, settlement: { mode: settlementMode, ...settlementMeta }, cogs: cogsMeta, accountingPolicy: opts.accountingPolicy || 'OPTION_C_BANK_CENTRIC_WORKING_CAPITAL' },
    });

    return { status: 'POSTED', glEntryIds: result.glEntryIds, message: 'Daily POS sales posted to GL' };
  } catch (e) {
    return { status: 'FAILED', reasonCode: e.code || 'DAILY_POSTING_FAILED', message: e.message || 'Daily POS posting failed' };
  }
};

module.exports = postDailySummaryPOS;
module.exports.post = postDailySummaryPOS;
module.exports.postDailySummaryPOS = postDailySummaryPOS;
