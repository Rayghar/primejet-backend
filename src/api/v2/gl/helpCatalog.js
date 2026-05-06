// File: src/api/v2/gl/helpCatalog.js

const GL_HELP_CATALOG = Object.freeze({
  gl: {
    title: 'General Ledger controls',
    items: [
      { key: 'chartOfAccounts', label: 'Chart of Accounts', help: 'The master list of accounting accounts used by posting handlers. Bootstrap creates required default accounts without deleting existing accounts.' },
      { key: 'postingReadiness', label: 'Posting Readiness', help: 'Pre-posting control that checks mandatory accounts, unposted source documents, failed postings, unbalanced journals, fiscal period status, stock setup and branch configuration.' },
      { key: 'postApproved', label: 'Post Approved Records', help: 'Posts approved daily summaries, approved expenses, stock-in records and delivered orders for the selected business date into the GL. It creates a posting batch for audit tracking.' },
      { key: 'retryFailed', label: 'Retry Failed Postings', help: 'Retries only source documents whose previous GL posting attempt failed. Fix source data issues first, then retry for the affected period.' },
      { key: 'rebuild', label: 'Rebuild GL', help: 'Regenerates GL entries from operational source documents for a period. Use with care and never for a locked accounting period.' },
      { key: 'trialBalance', label: 'Trial Balance', help: 'Shows debit and credit totals by account. A balanced trial balance is a minimum control before management accounts are trusted.' },
      { key: 'journalDrilldown', label: 'Journal Drilldown', help: 'Displays journal header, debit/credit lines, source document preview, posting batch reference and reversal history for audit review.' },
      { key: 'postingBatch', label: 'Posting Batch', help: 'Every posting action creates a batch showing what was attempted, posted, skipped and failed. Use the batch report to explain posting outcomes.' },
      { key: 'periodLock', label: 'Accounting Period Lock', help: 'Locks a month so postings, rebuilds, retries and reversals cannot alter closed financial results without an approved reopen.' },
      { key: 'reversalRequest', label: 'Reversal Request', help: 'Requests reversal of an incorrect posted journal. The maker-checker rule prevents the requester from approving their own reversal.' },
      { key: 'financeConfidence', label: 'Finance Data Confidence', help: 'Management reporting score based on trial balance, posting completeness, failed postings, stock setup, pricing setup, branch-stock mapping, period lock and reconciliation quality.' },
    ],
  },
  plantOperations: {
    title: 'Plant operations controls',
    items: [
      { key: 'openingStock', label: 'Opening LPG Stock', help: 'Initial LPG quantity and cost loaded per branch before normal trading. This anchors weighted average cost and COGS accuracy.' },
      { key: 'openingCylinders', label: 'Opening Cylinder Stock', help: 'Initial cylinder count by size for cylinder accountability. This is operational inventory and may not post to GL unless configured later.' },
      { key: 'stockIn', label: 'Stock-In', help: 'LPG purchase or stock receipt. It increases available stock and can post Dr LPG Inventory / Cr Cash, Bank or Payable depending on payment disposition.' },
      { key: 'wac', label: 'Weighted Average Cost', help: 'Average cost per kg recalculated from available stock layers. COGS uses this value when sales or delivered orders deplete LPG stock.' },
      { key: 'cogsActivation', label: 'COGS Activation', help: 'Branch-level gate that allows GL COGS posting only after stock, price and mapping readiness checks pass.' },
      { key: 'stockDepletion', label: 'Stock Depletion', help: 'Reduces stock when approved POS summaries or delivered orders consume LPG quantities.' },
      { key: 'stockReconciliation', label: 'Physical Stock Reconciliation', help: 'Compares system stock to physical stock count and records variance reasons. Variances can create adjustment movements for accountability.' },
      { key: 'branchPricing', label: 'Branch Effective Pricing', help: 'Branch-specific price per kg with effective dates. This protects historical pricing accuracy and supports profitability analysis.' },
      { key: 'plantStockMapping', label: 'Plant-to-Stock Mapping', help: 'Maps operational branches/plants to the stock location used by inventory and COGS controls.' },
      { key: 'branchProfitability', label: 'Branch Profitability', help: 'Revenue minus COGS and operating expenses by branch. Accuracy depends on stock setup, COGS activation, posting completeness and expense mapping.' },
    ],
  },
});

const flattenHelpCatalog = () => Object.entries(GL_HELP_CATALOG).flatMap(([groupKey, group]) =>
  (group.items || []).map((item) => ({ groupKey, groupTitle: group.title, ...item }))
);

module.exports = { GL_HELP_CATALOG, flattenHelpCatalog };
