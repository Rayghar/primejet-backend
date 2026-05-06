// File: src/api/v2/gl/services/coaMapping.service.js
// Central COA seed and deterministic operational-to-GL account mapping.

const ChartOfAccount = require('../../../../models/chartOfAccount.model');

const safeStr = (v) => (v === undefined || v === null ? '' : String(v));
const lc = (v) => safeStr(v).toLowerCase().trim();

const DEFAULT_ACCOUNTS = Object.freeze({
  CASH_ON_HAND: '1000',
  BANK_TRANSFERS: '1010',
  BANK_POS: '1020',
  CASH_OVER_SHORT: '1030',
  ACCOUNTS_RECEIVABLE: '1100',
  INVENTORY_LPG: '1200',
  ACCOUNTS_PAYABLE: '2000',
  TAX_PAYABLE: '2200',
  SHARE_CAPITAL: '3000',
  RETAINED_EARNINGS: '3100',
  OPENING_BALANCE_EQUITY: '3200',
  SALES_POS: '4000',
  SALES_DELIVERY: '4010',
  COGS_LPG: '5000',
  INVENTORY_VARIANCE: '5100',
  STAFF_COSTS: '6000',
  LOGISTICS_FUEL: '6100',
  UTILITIES: '6200',
  MAINTENANCE: '6300',
  MARKETING: '6400',
  ADMIN_GENERAL: '6500',
});

const DEFAULT_COA_ROWS = Object.freeze([
  { accountCode: '1000', name: 'Cash on Hand', type: 'ASSET', normalBalance: 'DEBIT', category: 'CASH' },
  { accountCode: '1010', name: 'Bank - Operating Account', type: 'ASSET', normalBalance: 'DEBIT', category: 'BANK' },
  { accountCode: '1020', name: 'POS Settlement Clearing', type: 'ASSET', normalBalance: 'DEBIT', category: 'BANK' },
  { accountCode: '1030', name: 'Cash Over / Short', type: 'EXPENSE', normalBalance: 'DEBIT', category: 'CONTROL' },
  { accountCode: '1100', name: 'Accounts Receivable', type: 'ASSET', normalBalance: 'DEBIT', category: 'AR' },
  { accountCode: '1200', name: 'LPG Inventory', type: 'ASSET', normalBalance: 'DEBIT', category: 'INVENTORY' },
  { accountCode: '2000', name: 'Accounts Payable', type: 'LIABILITY', normalBalance: 'CREDIT', category: 'AP' },
  { accountCode: '2200', name: 'Tax Payable', type: 'LIABILITY', normalBalance: 'CREDIT', category: 'TAX' },
  { accountCode: '3000', name: 'Share Capital', type: 'EQUITY', normalBalance: 'CREDIT', category: 'EQUITY' },
  { accountCode: '3100', name: 'Retained Earnings', type: 'EQUITY', normalBalance: 'CREDIT', category: 'EQUITY' },
  { accountCode: '3200', name: 'Opening Balance Equity', type: 'EQUITY', normalBalance: 'CREDIT', category: 'EQUITY' },
  { accountCode: '4000', name: 'LPG POS Sales Revenue', type: 'INCOME', normalBalance: 'CREDIT', category: 'REVENUE' },
  { accountCode: '4010', name: 'LPG Delivery Sales Revenue', type: 'INCOME', normalBalance: 'CREDIT', category: 'REVENUE' },
  { accountCode: '5000', name: 'LPG Cost of Goods Sold', type: 'EXPENSE', normalBalance: 'DEBIT', category: 'COGS' },
  { accountCode: '5100', name: 'Inventory Variance / Shrinkage', type: 'EXPENSE', normalBalance: 'DEBIT', category: 'COGS' },
  { accountCode: '6000', name: 'Staff Costs', type: 'EXPENSE', normalBalance: 'DEBIT', category: 'OPEX' },
  { accountCode: '6100', name: 'Logistics & Fuel', type: 'EXPENSE', normalBalance: 'DEBIT', category: 'OPEX' },
  { accountCode: '6200', name: 'Utilities', type: 'EXPENSE', normalBalance: 'DEBIT', category: 'OPEX' },
  { accountCode: '6300', name: 'Maintenance', type: 'EXPENSE', normalBalance: 'DEBIT', category: 'OPEX' },
  { accountCode: '6400', name: 'Marketing', type: 'EXPENSE', normalBalance: 'DEBIT', category: 'OPEX' },
  { accountCode: '6500', name: 'Admin & General Expenses', type: 'EXPENSE', normalBalance: 'DEBIT', category: 'OPEX' },
]);

const getAccountCode = (key) => DEFAULT_ACCOUNTS[key] || null;

const ensureDefaultCOA = async () => {
  for (const row of DEFAULT_COA_ROWS) {
    // eslint-disable-next-line no-await-in-loop
    await ChartOfAccount.updateOne(
      { accountCode: row.accountCode, branchScope: null },
      {
        // Keep bootstrap idempotent but also repair old/partial COA rows that
        // were created with only accountCode, which caused Trial Balance to show
        // account 3200 as Unknown instead of Opening Balance Equity.
        // Do not put branchScope in both $setOnInsert and $set. MongoDB treats
        // that as a conflicting update path and blocks GL bootstrap.
        $set: { ...row, branchScope: null, isActive: true },
      },
      { upsert: true }
    );
  }
  return { ok: true, count: DEFAULT_COA_ROWS.length };
};

const ensureAccountExists = async (accountCode) => {
  if (!accountCode) return false;
  const row = await ChartOfAccount.findOne({ accountCode: String(accountCode), isActive: true }).select('_id').lean();
  return Boolean(row);
};

const ensureAccountsExistOrThrow = async (codes = []) => {
  const unique = [...new Set((codes || []).filter(Boolean).map(String))];
  const rows = await ChartOfAccount.find({ accountCode: { $in: unique }, isActive: true }).select('accountCode').lean();
  const found = new Set(rows.map((r) => String(r.accountCode)));
  const missing = unique.filter((c) => !found.has(c));
  if (missing.length) {
    const e = new Error(`COA missing required accounts: ${missing.join(', ')}`);
    e.code = 'COA_MISSING_ACCOUNTS';
    e.missing = missing;
    throw e;
  }
  return true;
};

const mapExpenseCategoryToAccount = async (expense) => {
  const raw = lc(expense?.category || expense?.type || expense);
  if (raw.includes('staff') || raw.includes('salar') || raw.includes('wage')) return getAccountCode('STAFF_COSTS');
  if (raw.includes('logistics') || raw.includes('fuel') || raw.includes('transport') || raw.includes('dispatch') || raw.includes('vehicle')) return getAccountCode('LOGISTICS_FUEL');
  if (raw.includes('util') || raw.includes('power') || raw.includes('electric') || raw.includes('internet') || raw.includes('diesel')) return getAccountCode('UTILITIES');
  if (raw.includes('maint') || raw.includes('repair') || raw.includes('service')) return getAccountCode('MAINTENANCE');
  if (raw.includes('market') || raw.includes('advert') || raw.includes('promo')) return getAccountCode('MARKETING');
  return getAccountCode('ADMIN_GENERAL');
};

const mapPaymentToCreditAccount = async (paymentDispositionOrMethod) => {
  const pm = lc(paymentDispositionOrMethod);
  if (pm.includes('unpaid') || pm.includes('payable') || pm === 'ap' || pm.includes('credit')) return getAccountCode('ACCOUNTS_PAYABLE');
  if (pm.includes('transfer') || pm.includes('bank')) return getAccountCode('BANK_TRANSFERS');
  if (pm.includes('pos') || pm.includes('card')) return getAccountCode('BANK_POS');
  return getAccountCode('CASH_ON_HAND');
};

const mapPOSReceiptsSplitToDebitAccounts = async (dailySummary) => {
  const cash = Number(dailySummary?.sales?.cashAmount || 0) || 0;
  const transfer = Number(dailySummary?.sales?.transferAmount || 0) || 0;
  const pos = Number(dailySummary?.sales?.posAmount || 0) || 0;
  const totalRevenue = Number(dailySummary?.sales?.totalRevenue || 0) || 0;
  const parts = [
    { accountCode: getAccountCode('CASH_ON_HAND'), amount: cash },
    { accountCode: getAccountCode('BANK_TRANSFERS'), amount: transfer },
    { accountCode: getAccountCode('BANK_POS'), amount: pos },
  ].filter((p) => p.amount > 0.00001);
  if (parts.length === 0 && totalRevenue > 0) return [{ accountCode: getAccountCode('CASH_ON_HAND'), amount: totalRevenue }];
  return parts;
};

const mapOrderPaymentToDebitAccount = async (order, paid) => {
  if (!paid) return getAccountCode('ACCOUNTS_RECEIVABLE');
  const pm = lc(order?.paymentMethod);
  if (pm.includes('pos') || pm.includes('card')) return getAccountCode('BANK_POS');
  if (pm.includes('transfer') || pm.includes('bank')) return getAccountCode('BANK_TRANSFERS');
  return getAccountCode('CASH_ON_HAND');
};

const getRevenueAccountPOS = () => getAccountCode('SALES_POS');
const getRevenueAccountDelivery = () => getAccountCode('SALES_DELIVERY');
const getInventoryAccount = () => getAccountCode('INVENTORY_LPG');
const getCogsAccount = () => getAccountCode('COGS_LPG');
const getCashOverShortAccount = () => getAccountCode('CASH_OVER_SHORT');

const validateCoreCOAOrThrow = async () => {
  const required = Object.values(DEFAULT_ACCOUNTS).filter(Boolean);
  await ensureAccountsExistOrThrow(required);
  return { ok: true, requiredCount: required.length };
};

module.exports = {
  DEFAULT_ACCOUNTS,
  ensureDefaultCOA,
  ensureAccountExists,
  ensureAccountsExistOrThrow,
  validateCoreCOAOrThrow,
  mapExpenseCategoryToAccount,
  mapPaymentToCreditAccount,
  mapPOSReceiptsSplitToDebitAccounts,
  mapOrderPaymentToDebitAccount,
  getRevenueAccountPOS,
  getRevenueAccountDelivery,
  getInventoryAccount,
  getCogsAccount,
  getCashOverShortAccount,
};
