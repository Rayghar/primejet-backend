// src/api/v2/opening-balances/openingBalance.service.js
const mongoose = require('mongoose');
const OpeningBalance = require('../../../models/openingBalance.model');
const StockIn = require('../../../models/stockIn.model');
const Cylinder = require('../../../models/cylinder.model');
const HttpError = require('../../../utils/HttpError');
const { upsertJournal } = require('../gl/services/journalUpsert.service');
const { DEFAULT_ACCOUNTS, ensureAccountsExistOrThrow } = require('../gl/services/coaMapping.service');
const { recordStockInMovement } = require('../inventory/services/stockLedger.service');
const { validateStockInBeforeLog, assertValidPlant, assertOpenPeriod, parseDate, toNum, hasVal } = require('../control/operationalValidation.service');
const { writeControlAudit } = require('../control/auditTrail.service');

const dateKey = (d) => (parseDate(d) || new Date()).toISOString().slice(0, 10);

const buildOpeningLines = (payload) => {
  const cashOnHand = toNum(payload.cashOnHand, 0);
  const bankTransfers = toNum(payload.bankTransfers ?? payload.bankBalance, 0);
  const bankPOS = toNum(payload.bankPOS ?? payload.posSettlementBalance, 0);
  const inventoryValue = toNum(payload.inventoryValue, 0);
  const accountsReceivable = toNum(payload.accountsReceivable, 0);
  const accountsPayable = toNum(payload.accountsPayable, 0);
  const openingEquityInput = toNum(payload.openingEquity, NaN);
  const debits = cashOnHand + bankTransfers + bankPOS + inventoryValue + accountsReceivable;
  const creditsBeforeEquity = accountsPayable;
  const openingEquity = Number.isFinite(openingEquityInput) ? openingEquityInput : Math.max(0, debits - creditsBeforeEquity);
  const credits = creditsBeforeEquity + openingEquity;
  const lines = [];
  if (cashOnHand > 0) lines.push({ accountCode: DEFAULT_ACCOUNTS.CASH_ON_HAND, debit: cashOnHand, credit: 0, narration: 'Opening cash on hand' });
  if (bankTransfers > 0) lines.push({ accountCode: DEFAULT_ACCOUNTS.BANK_TRANSFERS, debit: bankTransfers, credit: 0, narration: 'Opening bank transfer balance' });
  if (bankPOS > 0) lines.push({ accountCode: DEFAULT_ACCOUNTS.BANK_POS, debit: bankPOS, credit: 0, narration: 'Opening POS settlement balance' });
  if (inventoryValue > 0) lines.push({ accountCode: DEFAULT_ACCOUNTS.INVENTORY_LPG, debit: inventoryValue, credit: 0, narration: 'Opening LPG inventory value' });
  if (accountsReceivable > 0) lines.push({ accountCode: DEFAULT_ACCOUNTS.ACCOUNTS_RECEIVABLE, debit: accountsReceivable, credit: 0, narration: 'Opening receivables' });
  if (accountsPayable > 0) lines.push({ accountCode: DEFAULT_ACCOUNTS.ACCOUNTS_PAYABLE, debit: 0, credit: accountsPayable, narration: 'Opening payables' });
  if (openingEquity > 0) lines.push({ accountCode: DEFAULT_ACCOUNTS.OPENING_BALANCE_EQUITY, debit: 0, credit: openingEquity, narration: 'Opening balance equity' });
  return { lines, totals: { debits, credits, variance: debits - credits, openingEquity }, values: { cashOnHand, bankTransfers, bankPOS, inventoryValue, accountsReceivable, accountsPayable, openingEquity } };
};

const validateOpeningPayload = async (payload, { forPost = false } = {}) => {
  const branchId = String(payload.branchId || payload.plantId || '').trim();
  if (!branchId) throw new HttpError(400, 'branchId / plantId is required.');
  const businessDate = parseDate(payload.businessDate || payload.date);
  if (!businessDate) throw new HttpError(400, 'businessDate is invalid.');
  await assertValidPlant(branchId, { requireOperational: false });
  await assertOpenPeriod(businessDate, 'post opening balances');
  const invQty = toNum(payload.inventoryQuantityKg ?? payload.quantityKg, 0);
  const invCost = toNum(payload.inventoryCostPerKg ?? payload.costPerKg, 0);
  const invValue = toNum(payload.inventoryValue, invQty * invCost);
  if (invQty > 0 && invCost <= 0) throw new HttpError(400, 'inventoryCostPerKg is required when opening inventory quantity is provided.');
  if (invValue > 0 && invQty <= 0) throw new HttpError(400, 'inventoryQuantityKg is required when opening inventory value is provided.');
  if (invQty > 0) await validateStockInBeforeLog({ branchId, quantityKg: invQty, costPerKg: invCost, supplier: 'Opening Balance', purchaseDate: businessDate });
  const { lines, totals, values } = buildOpeningLines({ ...payload, inventoryValue: invValue });
  if (!lines.length) throw new HttpError(400, 'At least one opening balance line is required.');
  if (Math.abs(totals.variance) > 0.01) throw new HttpError(400, `Opening balance is not balanced. Debit/Credit variance: ${totals.variance}.`);
  if (forPost) await ensureAccountsExistOrThrow(lines.map((l) => l.accountCode));
  return { branchId, businessDate, inventoryQuantityKg: invQty, inventoryCostPerKg: invCost, inventoryValue: invValue, lines, totals, values };
};

const listOpeningBalances = async (filters = {}) => {
  const q = {};
  if (filters.branchId) q.branchId = String(filters.branchId);
  if (filters.status) q.status = String(filters.status).toUpperCase();
  return OpeningBalance.find(q).sort({ businessDate: -1, createdAt: -1 }).limit(Number(filters.limit) || 200).lean();
};

const getReadiness = async (filters = {}) => {
  const branchId = filters.branchId ? String(filters.branchId) : null;
  const q = branchId ? { branchId } : {};
  const posted = await OpeningBalance.find(q).sort({ businessDate: -1 }).lean();
  return {
    ok: true,
    branchId,
    hasPostedOpeningBalance: posted.some((x) => x.status === 'POSTED' || x.posting?.status === 'POSTED'),
    latest: posted[0] || null,
    controls: [
      { key: 'branch_selected', label: 'Branch/plant selected', passed: Boolean(branchId), message: branchId ? 'Branch scope is selected.' : 'Select a plant/branch.' },
      { key: 'posted_opening_balance', label: 'Opening balance posted', passed: posted.some((x) => x.status === 'POSTED' || x.posting?.status === 'POSTED'), message: posted.length ? 'Opening balance exists for this scope.' : 'No opening balance has been posted for this scope.' },
    ],
  };
};

const saveDraft = async (payload, userId = 'system') => {
  const v = await validateOpeningPayload(payload, { forPost: false });
  const businessDate = v.businessDate;
  const ob = await OpeningBalance.findOneAndUpdate(
    { branchId: v.branchId, openingDateKey: dateKey(businessDate) },
    {
      $set: {
        branchId: v.branchId,
        businessDate,
        ...v.values,
        inventoryValue: v.inventoryValue,
        inventoryQuantityKg: v.inventoryQuantityKg,
        inventoryCostPerKg: v.inventoryCostPerKg,
        cylinderBalances: Array.isArray(payload.cylinderBalances) ? payload.cylinderBalances : [],
        lineItems: v.lines,
        readiness: { totals: v.totals, validatedAt: new Date() },
        notes: payload.notes || null,
        status: 'DRAFT',
        createdBy: userId,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  await writeControlAudit({ branchId: v.branchId, businessDate, action: 'OPENING_BALANCE_DRAFTED', performedBy: userId, meta: { openingBalanceId: ob.id, totals: v.totals } });
  return ob;
};

const submit = async (id, userId = 'system') => {
  const ob = await OpeningBalance.findOne({ $or: [{ id }, mongoose.Types.ObjectId.isValid(String(id)) ? { _id: id } : null].filter(Boolean) });
  if (!ob) throw new HttpError(404, 'Opening balance not found.');
  if (ob.status === 'POSTED' || ob.posting?.status === 'POSTED') throw new HttpError(400, 'Opening balance is already posted.');
  ob.status = 'SUBMITTED';
  ob.submittedBy = userId;
  ob.submittedAt = new Date();
  await ob.save();
  await writeControlAudit({ branchId: ob.branchId, businessDate: ob.businessDate, action: 'OPENING_BALANCE_SUBMITTED', performedBy: userId, meta: { openingBalanceId: ob.id } });
  return ob;
};

const post = async (id, userId = 'system') => {
  const ob = await OpeningBalance.findOne({ $or: [{ id }, mongoose.Types.ObjectId.isValid(String(id)) ? { _id: id } : null].filter(Boolean) });
  if (!ob) throw new HttpError(404, 'Opening balance not found.');
  if (ob.posting?.status === 'POSTED' || ob.status === 'POSTED') return ob;
  const v = await validateOpeningPayload(ob.toObject(), { forPost: true });
  const jr = await upsertJournal({
    date: v.businessDate,
    branchKey: v.branchId,
    sourceType: 'OPENING_BALANCE',
    sourceId: `OPENING_BALANCE:${ob.id}`,
    entryType: 'OPENING_BALANCE',
    narration: 'Opening balance wizard posting',
    lines: v.lines,
    meta: { openingBalanceId: ob.id },
  });
  ob.status = 'POSTED';
  ob.posting = { status: 'POSTED', glEntryIds: jr.glEntryIds || [], postedAt: new Date(), errorMessage: null };
  ob.approvedBy = userId;
  ob.approvedAt = new Date();
  await ob.save();

  if (v.inventoryQuantityKg > 0) {
    const stock = await StockIn.create({
      id: new mongoose.Types.ObjectId().toString(),
      branchId: v.branchId,
      stockType: 'OPENING_STOCK',
      quantityKg: v.inventoryQuantityKg,
      remainingKg: v.inventoryQuantityKg,
      supplier: 'Opening Balance Wizard',
      purchaseDate: v.businessDate,
      costPerKg: v.inventoryCostPerKg,
      targetSalePricePerKg: Math.max(v.inventoryCostPerKg, toNum(ob.targetSalePricePerKg, v.inventoryCostPerKg)),
      amountPaid: 0,
      paidAmount: 0,
      isPaid: false,
      paymentStatus: 'OPENING_BALANCE',
      loggedBy: { uid: userId, email: 'system@local' },
    });
    await recordStockInMovement(stock, userId);
  }
  for (const c of ob.cylinderBalances || []) {
    if (!hasVal(c.size)) continue;
    const qty = toNum(c.quantity, 0);
    if (qty < 0) continue;
    // eslint-disable-next-line no-await-in-loop
    await Cylinder.create({ id: new mongoose.Types.ObjectId().toString(), size: String(c.size), quantity: qty });
  }
  await writeControlAudit({ branchId: ob.branchId, businessDate: ob.businessDate, action: 'OPENING_BALANCE_POSTED', performedBy: userId, meta: { openingBalanceId: ob.id, glEntryIds: jr.glEntryIds || [] } });
  return ob;
};

module.exports = { listOpeningBalances, getReadiness, saveDraft, submit, post, validateOpeningPayload };
