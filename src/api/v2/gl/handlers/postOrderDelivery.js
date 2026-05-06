// File: src/api/v2/gl/handlers/postOrderDelivery.js
//
// GL Posting Handler: Delivery Orders
//
// GL-FIRST rules (aligned with your Management Accounts + GL policy):
// - Business date: Order.orderDate (fallback: createdAt ONLY if orderDate missing)
// - Post ONLY when:
//    1) status == Delivered  (case-insensitive)
//    2) channel is DELIVERY if channel exists (legacy: missing channel => treat as delivery)
//    3) paymentStatus is PAID based on policy (default: completed/paid/success/successful)
// - Journal (paid delivery):
//    Dr Cash/Bank (mapped by paymentMethod)
//    Cr Sales Revenue - Delivery (4010)
// - OPTIONAL (if you later enable credit-delivery posting):
//    If Delivered but unpaid, post Dr A/R (1100) Cr Revenue (4010)
// - COGS (optional but recommended when inventory+WAC are reliable):
//    Dr COGS (5000) = kgSold × WAC(asOf businessDate)
//    Cr Inventory (1200)
//
// Idempotency:
// - Upsert GL entry by {branchKey, sourceType:'ORDER', sourceId, entryType}
//
// Posting metadata:
// - Best-effort updates to Order.posting.* (requires schema support)

const mongoose = require('mongoose');

const Order = require('../../../../models/order.model');
const GeneralLedgerEntry = require('../../../../models/generalLedgerEntry.model');
const StockIn = require('../../../../models/stockIn.model');
const BranchStockConfig = require('../../../../models/branchStockConfig.model');

// Optional policy matrix
let policy = null;
try {
  // Expected: src/api/v2/gl/policyMatrix.js
  // eslint-disable-next-line global-require
  policy = require('../policyMatrix');
} catch (e) {
  policy = null;
}

// -------------------------
// tiny helpers
// -------------------------
const safeNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const toISODate = (d) => {
  const x = d ? new Date(d) : null;
  return x && !Number.isNaN(x.getTime()) ? x : null;
};

const endOfDay = (d) => {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
};

const toBranchKey = (doc) => {
  const v = doc?.branchId ?? doc?.serviceZoneId ?? doc?.zoneId ?? doc?.plantId ?? null;
  return v == null ? null : String(v);
};

const sumLines = (lines) => {
  const debit = (lines || []).reduce((s, l) => s + safeNum(l.debit, 0), 0);
  const credit = (lines || []).reduce((s, l) => s + safeNum(l.credit, 0), 0);
  return { debit, credit };
};


const derivePeriodKey = (date) => {
  const d = new Date(date || new Date());
  return Number.isNaN(d.getTime()) ? new Date().toISOString().slice(0, 7) : d.toISOString().slice(0, 7);
};

const assertBalanced = (lines, tolerance = 0.5) => {
  const { debit, credit } = sumLines(lines);
  const diff = Math.abs(debit - credit);
  if (diff > tolerance) {
    const e = new Error(`Unbalanced journal: debit=${debit}, credit=${credit}, diff=${diff}`);
    e.code = 'UNBALANCED_JOURNAL';
    e.meta = { debit, credit, diff };
    throw e;
  }
};

const norm = (s) => String(s || '').toLowerCase().trim();

const isDelivered = (status) => norm(status) === 'delivered';

// Default paid rule (can be overridden by policy.paidRule)
const defaultIsPaid = (paymentStatus) => {
  const ps = norm(paymentStatus);
  return ps === 'completed' || ps === 'paid' || ps === 'success' || ps === 'successful';
};

const isPaid = (paymentStatus) => {
  if (typeof policy?.paidRule === 'function') return Boolean(policy.paidRule(paymentStatus));
  return defaultIsPaid(paymentStatus);
};

const getAccounts = () => {
  const a = policy?.accounts && typeof policy.accounts === 'object' ? policy.accounts : {};
  return {
    CASH_ON_HAND: a.CASH_ON_HAND || '1000',
    BANK_TRANSFER: a.BANK_TRANSFER || '1010',
    BANK_POS: a.BANK_POS || '1020',
    ACCOUNTS_RECEIVABLE: a.ACCOUNTS_RECEIVABLE || '1100',
    INVENTORY_LPG: a.INVENTORY_LPG || '1200',
    SALES_DELIVERY: a.SALES_DELIVERY || '4010',
    COGS_LPG: a.COGS_LPG || '5000',
  };
};

const getTolerances = () => {
  const t = policy?.tolerances && typeof policy.tolerances === 'object' ? policy.tolerances : {};
  return {
    journalBalance: safeNum(t.journalBalance, 0.5),
  };
};

// Credit sales toggle (default false for GL-only-when-paid)
const allowUnpaidDeliveredToAR = () => {
  const v = policy?.features?.allowUnpaidDeliveredToAR;
  return Boolean(v);
};

// COGS posting toggle
const enableCogsOnSale = () => {
  const v = policy?.features?.enableCogsOnSale;
  return v === undefined ? true : Boolean(v);
};

// Channel guard: if channel exists, must be DELIVERY
const isDeliveryChannel = (order) => {
  const ch = order?.channel;
  if (ch === undefined || ch === null || String(ch).trim() === '') return true; // legacy
  return String(ch).toUpperCase().trim() === 'DELIVERY';
};

// Map payment method to cash/bank account
const mapPaymentToCashAccount = (paymentMethod, accounts) => {
  const pm = norm(paymentMethod);

  // You can tailor these strings to your app’s real values:
  if (pm.includes('pos') || pm.includes('card')) return accounts.BANK_POS;
  if (pm.includes('transfer') || pm.includes('bank')) return accounts.BANK_TRANSFER;

  // payOnPickup / cash / unknown => cash on hand
  return accounts.CASH_ON_HAND;
};

// WAC (Weighted Average Cost) as-of business date for branch
const getWacCostPerKgAsOf = async (branchKey, asOfDate) => {
  const match = { purchaseDate: { $lte: asOfDate } };

  if (branchKey) {
    match.$or = [{ branchId: branchKey }, { serviceZoneId: branchKey }, { zoneId: branchKey }, { plantId: branchKey }];

    // Also match ObjectId if branchKey looks like one
    if (mongoose.Types.ObjectId.isValid(String(branchKey))) {
      const oid = new mongoose.Types.ObjectId(String(branchKey));
      match.$or.push({ branchId: oid }, { serviceZoneId: oid }, { zoneId: oid }, { plantId: oid });
    }
  }

  const rows = await StockIn.find(match).select('quantityKg costPerKg').lean();

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

  return totalKg > 0 ? totalCost / totalKg : 0;
};

// Upsert GL entry (idempotent)
const upsertGLEntry = async ({ date, branchKey, sourceType, sourceId, entryType = 'PRIMARY', narration, lines }) => {
  const { debit, credit } = sumLines(lines);

  const doc = {
    date,
    periodKey: derivePeriodKey(date),
    branchKey: branchKey || null,
    sourceType,
    sourceId: String(sourceId),
    entryType,
    version: 1,
    status: 'POSTED',
    narration: narration || '',
    lines,
    totals: { debit, credit, diff: Math.abs(debit - credit) },
  };

  const filter = { branchKey: branchKey || null, sourceType, sourceId: String(sourceId), entryType, version: 1 };

  await GeneralLedgerEntry.updateOne(filter, { $set: doc }, { upsert: true });

  const saved = await GeneralLedgerEntry.findOne(filter).select('_id').lean();
  return saved?._id || null;
};

/**
 * postOrderDelivery
 *
 * @param {Object|string} orderOrId - Order document OR _id
 * @param {Object} opts
 * @param {string|null} opts.entryType
 * @param {string|null} opts.postedBy
 *
 * @returns {Promise<{posted?:boolean, skipped?:boolean, reason?:string, glEntryId?:any, paid?:boolean}>}
 */
async function postOrderDelivery(orderOrId, opts = {}) {
  const accounts = getAccounts();
  const tol = getTolerances();

  const order =
    typeof orderOrId === 'string' || mongoose.Types.ObjectId.isValid(String(orderOrId))
      ? await Order.findById(orderOrId).lean()
      : orderOrId;

  if (!order) return { skipped: true, reason: 'ORDER_NOT_FOUND' };

  // Business date: orderDate preferred, fallback to createdAt ONLY if orderDate missing
  const businessDate = toISODate(order?.orderDate || (order?.orderDate == null ? order?.createdAt : null));
  if (!businessDate) return { skipped: true, reason: 'ORDER_INVALID_BUSINESS_DATE' };

  const branchKey = toBranchKey(order);
  if (!branchKey) return { skipped: true, reason: 'ORDER_MISSING_BRANCH' };

  if (!isDelivered(order?.status)) return { skipped: true, reason: 'ORDER_NOT_DELIVERED' };

  if (!isDeliveryChannel(order)) return { skipped: true, reason: 'ORDER_NOT_DELIVERY_CHANNEL' };

  const amount = safeNum(order?.grandTotal ?? order?.totalAmount, 0);
  if (amount <= 0) return { skipped: true, reason: 'ORDER_AMOUNT_ZERO' };

  const paid = isPaid(order?.paymentStatus);

  // Default GL-only rule: do NOT post unpaid deliveries, unless explicitly enabled
  if (!paid && !allowUnpaidDeliveredToAR()) {
    return { skipped: true, reason: 'ORDER_UNPAID_DELIVERED_SKIPPED' };
  }

  const debitAccount = paid ? mapPaymentToCashAccount(order?.paymentMethod, accounts) : accounts.ACCOUNTS_RECEIVABLE;

  // Compute KG sold (if items.quantity is KG). If your items are cylinders, this is not kg.
  // In that case, either:
  //  - store a dedicated `kgSold` on Order, or
  //  - map cylinder size -> kg conversion in policy, later.
  const items = Array.isArray(order?.items) ? order.items : [];
  const qtySum = items.reduce((s, it) => s + safeNum(it?.quantity, 0), 0);

  // If you have a policy converter, use it; else use qtySum directly.
  const kgSold =
    typeof policy?.convertOrderItemsToKg === 'function'
      ? safeNum(policy.convertOrderItemsToKg(order), 0)
      : qtySum;

  // Build journal
  const lines = [
    {
      accountCode: String(debitAccount),
      debit: amount,
      credit: 0,
      narration: paid ? 'Delivery sale receipt (paid)' : 'Delivery sale (A/R)',
    },
    {
      accountCode: String(accounts.SALES_DELIVERY),
      debit: 0,
      credit: amount,
      narration: 'Delivery sales revenue',
    },
  ];

  // COGS posting (optional, based on WAC) only after branch COGS activation.
  const branchCogsConfig = await BranchStockConfig.findOne({ branchId: String(branchKey), isActive: { $ne: false } }).lean().catch(() => null);
  const branchCogsEnabled = opts.forceCogs === true || Boolean(branchCogsConfig?.cogsEnabled);
  if (enableCogsOnSale() && branchCogsEnabled && kgSold > 0) {
    const wac = await getWacCostPerKgAsOf(branchKey, endOfDay(businessDate));
    const cogs = kgSold > 0 && wac > 0 ? kgSold * wac : 0;

    if (cogs > 0) {
      lines.push({ accountCode: String(accounts.COGS_LPG), debit: cogs, credit: 0, narration: 'COGS (WAC) for delivery sales' });
      lines.push({
        accountCode: String(accounts.INVENTORY_LPG),
        debit: 0,
        credit: cogs,
        narration: 'Inventory reduction (WAC) for delivery sales',
      });
    }
  }

  assertBalanced(lines, tol.journalBalance);

  const sourceId = String(order?._id);
  const glEntryId = await upsertGLEntry({
    date: businessDate,
    branchKey,
    sourceType: 'ORDER',
    sourceId,
    entryType: opts.entryType || 'PRIMARY',
    narration: `Delivery Order ${sourceId}`.slice(0, 180),
    lines,
  });

  // Best-effort: update order posting metadata (requires schema support)
  try {
    await Order.updateOne(
      { _id: order._id },
      {
        $set: {
          posting: {
            status: 'POSTED',
            glEntryId,
            postedAt: new Date(),
            postedBy: opts.postedBy || null,
            attempts: safeNum(order?.posting?.attempts, 0) + 1,
            errorCode: null,
            errorMessage: null,
            version: safeNum(order?.posting?.version, 1),
          },
        },
      }
    );
  } catch (e) {
    // ignore if schema doesn't support posting fields yet
  }

  return {
    posted: true,
    glEntryId,
    branchKey,
    businessDate,
    paid,
    amount,
    kgSold,
  };
}

module.exports = postOrderDelivery;
module.exports.postOrderDelivery = postOrderDelivery;