/**
 * File: src/api/v2/gl/policyMatrix.js
 *
 * GL Posting Policy Matrix (GL-first, migration-safe)
 *
 * Purpose:
 * - Centralize accounting rules so posting.service + posting handlers never hardcode logic.
 * - Support migrated historical data where POS sales exist only as DailySummary totals (no line items).
 *
 * Notes:
 * - This is a POLICY CONFIG, not a service.
 * - Keep it deterministic and versioned; migrations should record the policy version used.
 */

const POLICY_VERSION = 1;

/**
 * Recognition rules:
 * - You asked before: "only paymentStatus=completed counted as sale?"
 *   If YES, keep DELIVERY_PAID_STATUSES = ['completed'].
 *   If you want to allow paid/success etc, add them.
 */
const DELIVERY_PAID_STATUSES = ['completed']; // strict mode (recommended for clarity)
const POS_APPROVED_STATUS = 'approved';

/**
 * Posting tolerances & behavior
 */
const TOLERANCE = {
  // If (cash+pos+transfer) differs from totalRevenue by <= this, treat as rounding and post diff to over/short.
  tenderMismatchNaira: 5, // ₦5 tolerance
};

/**
 * COGS Mode
 * - For migration, keep OFF until StockIn history is complete & WAC is trustworthy.
 * - When ON, DailySummary and Orders can post Dr COGS / Cr Inventory using WAC cost.
 */
const COGS_MODE = {
  enabled: false, // 🔥 migration-safe default
  method: 'WAC', // 'WAC' only for now
  requireStockForWac: false, // if true and WAC=0 => fail posting; if false => skip COGS lines
};

/**
 * Chart of Accounts
 * You can extend this list later (but keep codes stable once migrated).
 *
 * IMPORTANT:
 * - Posting handlers should never use names; they should use account codes.
 */
const COA = {
  // ASSETS
  CASH_ON_HAND: '1000',
  BANK_TRANSFERS: '1010',
  BANK_POS: '1020',
  ACCOUNTS_RECEIVABLE: '1100',
  INVENTORY_LPG: '1200',

  // LIABILITIES
  ACCOUNTS_PAYABLE: '2000',
  TAX_PAYABLE: '2200',

  // EQUITY
  SHARE_CAPITAL: '3000',
  RETAINED_EARNINGS: '3100',

  // INCOME
  SALES_POS_LPG: '4000',
  SALES_DELIVERY_LPG: '4010',

  // EXPENSES
  COGS_LPG: '5000',
  STAFF_COSTS: '6000',
  LOGISTICS_FUEL: '6100',
  UTILITIES: '6200',
  MAINTENANCE: '6300',
  MARKETING: '6400',
  ADMIN_GENERAL: '6500',

  // NEW (recommended): to handle tender mismatch & reconciliation variance
  CASH_OVER_SHORT: '1030', // add to default COA seeding
};

/**
 * Expense category mapping
 * Input: ExpenseTransaction.category OR ExpenseTransaction.type
 */
const EXPENSE_CATEGORY_TO_ACCOUNT = [
  { match: ['salar', 'wages', 'staff', 'payroll'], accountCode: COA.STAFF_COSTS, code: 'EXP_STAFF' },
  { match: ['fuel', 'transport', 'vehicle', 'dispatch', 'logistics'], accountCode: COA.LOGISTICS_FUEL, code: 'EXP_LOGISTICS' },
  { match: ['power', 'electric', 'internet', 'diesel', 'utility'], accountCode: COA.UTILITIES, code: 'EXP_UTILITIES' },
  { match: ['maint', 'repair', 'service'], accountCode: COA.MAINTENANCE, code: 'EXP_MAINT' },
  { match: ['market', 'adver', 'promo', 'branding'], accountCode: COA.MARKETING, code: 'EXP_MKT' },
  { match: [], accountCode: COA.ADMIN_GENERAL, code: 'EXP_ADMIN_DEFAULT' }, // fallback
];

/**
 * Expense payment disposition mapping (credit leg)
 *
 * You MUST drive this from UI going forward, e.g.:
 *   exp.paymentDisposition = 'CASH'|'TRANSFER'|'POS'|'UNPAID'
 *
 * For migrated expenses:
 * - if paymentDisposition is missing, we default to CASH (conservative) OR you can default to AP.
 */
const EXPENSE_PAYMENT_DISPOSITION_TO_CREDIT_ACCOUNT = {
  CASH: COA.CASH_ON_HAND,
  TRANSFER: COA.BANK_TRANSFERS,
  POS: COA.BANK_POS,
  UNPAID: COA.ACCOUNTS_PAYABLE,
  // fallback default if missing
  DEFAULT: COA.CASH_ON_HAND,
};

/**
 * DailySummary tender split mapping
 * - Uses your existing fields: cashAmount, posAmount, transferAmount
 * - Credit is totalRevenue to SALES_POS_LPG
 */
const DAILY_SUMMARY_POS_RULE = {
  sourceType: 'DAILY_SUMMARY',
  trigger: {
    when: 'STATUS_APPROVED',
    statusField: 'status',
    statusValue: POS_APPROVED_STATUS,
  },
  businessDateField: 'date',
  branchField: 'branchId',
  revenueField: 'sales.totalRevenue',
  kgSoldField: 'sales.totalKgSold',
  tenders: [
    { field: 'sales.cashAmount', debitAccount: COA.CASH_ON_HAND, code: 'TENDER_CASH' },
    { field: 'sales.transferAmount', debitAccount: COA.BANK_TRANSFERS, code: 'TENDER_TRANSFER' },
    { field: 'sales.posAmount', debitAccount: COA.BANK_POS, code: 'TENDER_POS' },
  ],
  creditAccount: COA.SALES_POS_LPG,
  tenderMismatch: {
    enabled: true,
    tolerance: TOLERANCE.tenderMismatchNaira,
    // if mismatch within tolerance, post difference to CASH_OVER_SHORT
    differenceAccount: COA.CASH_OVER_SHORT,
    // If mismatch beyond tolerance: FAIL posting (preferred) or auto-post to Cash Over/Short anyway.
    failIfBeyondTolerance: true,
  },
  cogs: {
    enabled: COGS_MODE.enabled,
    method: COGS_MODE.method,
    debitAccount: COA.COGS_LPG,
    creditAccount: COA.INVENTORY_LPG,
    requireWac: COGS_MODE.requireStockForWac,
  },
};

/**
 * Delivery Order rule
 * - Post only when Delivered + paymentStatus meets rule
 * - Business date: orderDate fallback createdAt (handler decides)
 */
const ORDER_DELIVERY_RULE = {
  sourceType: 'ORDER',
  trigger: {
    when: 'STATUS_DELIVERED',
    statusField: 'status',
    statusValue: 'Delivered', // allow case-insensitive handling in code
  },
  businessDateFields: ['orderDate', 'createdAt'], // in priority order
  branchFieldCandidates: ['branchId', 'serviceZoneId', 'zoneId', 'plantId'],
  amountFieldCandidates: ['grandTotal', 'totalAmount'],
  recognition: {
    // Strict “Completed only” by default; can be broadened.
    paidStatuses: DELIVERY_PAID_STATUSES,
    paymentStatusField: 'paymentStatus',
    paymentMethodField: 'paymentMethod',
    // If delivered but unpaid: choose whether to post AR or skip entirely.
    // For now: skip unpaid to match “recognized revenue only”.
    postUnpaidToAR: false,
    arAccount: COA.ACCOUNTS_RECEIVABLE,
  },
  debitAccountsByPaymentMethod: {
    POS: COA.BANK_POS,
    CARD: COA.BANK_POS,
    TRANSFER: COA.BANK_TRANSFERS,
    BANK: COA.BANK_TRANSFERS,
    CASH: COA.CASH_ON_HAND,
    DEFAULT: COA.CASH_ON_HAND,
  },
  creditAccount: COA.SALES_DELIVERY_LPG,
  cogs: {
    enabled: COGS_MODE.enabled,
    method: COGS_MODE.method,
    debitAccount: COA.COGS_LPG,
    creditAccount: COA.INVENTORY_LPG,
    requireWac: COGS_MODE.requireStockForWac,
    // kgSold: typically order.items[].quantity (your system uses cylinder sizes; may not be kg).
    // handler can compute "kgEquivalent" later if you add it. For now it can skip if cannot compute.
  },
};

/**
 * ExpenseTransaction rule
 * - Business date: ExpenseTransaction.date (critical after migration)
 */
const EXPENSE_RULE = {
  sourceType: 'EXPENSE',
  businessDateField: 'date',
  branchField: 'branchId',
  amountField: 'amount',
  descriptionField: 'description',
  categoryFieldCandidates: ['category', 'type'],
  posting: {
    debitAccountFromCategory: EXPENSE_CATEGORY_TO_ACCOUNT,
    creditAccountFromDisposition: EXPENSE_PAYMENT_DISPOSITION_TO_CREDIT_ACCOUNT,
    dispositionFieldCandidates: ['paymentDisposition', 'paymentMethod', 'mode'],
    requireDisposition: false, // for migration: allow missing => DEFAULT
  },
};

/**
 * StockIn rule
 * - Business date: StockIn.purchaseDate
 * - Journal: Dr Inventory, Cr Bank/AP
 */
const STOCKIN_RULE = {
  sourceType: 'STOCK_IN',
  businessDateField: 'purchaseDate',
  branchFieldCandidates: ['branchId', 'serviceZoneId', 'zoneId', 'plantId'],
  quantityField: 'quantityKg',
  costPerKgField: 'costPerKg',
  payment: {
    amountPaidFieldCandidates: ['amountPaid', 'paidAmount'],
    paymentStatusField: 'paymentStatus',
    isPaidField: 'isPaid',
    // If paid => credit bank transfers
    creditPaidAccount: COA.BANK_TRANSFERS,
    // If unpaid/unknown => credit AP
    creditUnpaidAccount: COA.ACCOUNTS_PAYABLE,
    // If partial => split credit between bank and AP
  },
  debitAccount: COA.INVENTORY_LPG,
};

/**
 * Policy matrix export
 */
module.exports = {
  version: POLICY_VERSION,

  // Global switches
  recognition: {
    deliveryPaidStatuses: DELIVERY_PAID_STATUSES,
    posApprovedStatus: POS_APPROVED_STATUS,
  },
  tolerance: TOLERANCE,
  cogsMode: COGS_MODE,

  // COA codes
  coa: COA,

  // Posting policies
  policies: {
    DAILY_SUMMARY_POS: DAILY_SUMMARY_POS_RULE,
    ORDER_DELIVERY: ORDER_DELIVERY_RULE,
    EXPENSE: EXPENSE_RULE,
    STOCK_IN: STOCKIN_RULE,
  },

  // Mappers (used by services)
  maps: {
    expenseCategoryToAccount: EXPENSE_CATEGORY_TO_ACCOUNT,
    expenseDispositionToCreditAccount: EXPENSE_PAYMENT_DISPOSITION_TO_CREDIT_ACCOUNT,
  },
};