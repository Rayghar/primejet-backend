// src/api/v2/loan-readiness/loanReadiness.service.js
const mongoose = require('mongoose');
const DailySummary = require('../../../models/dailySummary.model');
const ExpenseTransaction = require('../../../models/expenseTransaction.model');
const Order = require('../../../models/order.model');
const StockMovement = require('../../../models/stockMovement.model');
const SettlementConfirmation = require('../../../models/settlementConfirmation.model');
const StatementUpload = require('../../../models/statementUpload.model');
const GeneralLedgerEntry = require('../../../models/generalLedgerEntry.model');
const OpeningBalance = require('../../../models/openingBalance.model');
const LoanScenario = require('../../../models/loanScenario.model');

const safeNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const round = (v, dp = 2) => Number((safeNum(v, 0)).toFixed(dp));

const parseRate = (v) => {
  const n = safeNum(v, 0);
  if (n > 1) return n / 100;
  return n;
};

const parseDateRange = ({ startDate, endDate, monthsBack = 6 } = {}) => {
  const end = endDate ? new Date(endDate) : new Date();
  if (Number.isNaN(end.getTime())) throw new Error('Invalid end date.');
  end.setHours(23, 59, 59, 999);
  const start = startDate ? new Date(startDate) : new Date(end);
  if (!startDate) start.setMonth(start.getMonth() - monthsBack + 1, 1);
  if (Number.isNaN(start.getTime())) throw new Error('Invalid start date.');
  start.setHours(0, 0, 0, 0);
  return { start, end };
};

const asObjectId = (v) => mongoose.Types.ObjectId.isValid(String(v)) ? new mongoose.Types.ObjectId(String(v)) : null;

const branchMatch = (branchId) => {
  if (!branchId) return {};
  const s = String(branchId);
  const ors = [{ branchId: s }, { serviceZoneId: s }, { zoneId: s }, { plantId: s }, { branchKey: s }];
  const oid = asObjectId(s);
  if (oid) ors.push({ branchId: oid }, { serviceZoneId: oid }, { zoneId: oid }, { plantId: oid });
  return { $or: ors };
};

const monthDiffInclusive = (start, end) => {
  const s = new Date(start);
  const e = new Date(end);
  return Math.max(1, (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1);
};

const derivePeriodKey = (date) => {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 7);
  return d.toISOString().slice(0, 7);
};

const getActualMonthlyBaseline = async ({ startDate, endDate, branchId } = {}) => {
  const { start, end } = parseDateRange({ startDate, endDate, monthsBack: 6 });
  const months = monthDiffInclusive(start, end);
  const bm = branchMatch(branchId);
  const dateMatch = { $gte: start, $lte: end };

  const [summaries, expenses, orders, movements, settlements, uploads, openingBalances, glEntries] = await Promise.all([
    DailySummary.find({ ...bm, date: dateMatch }).lean(),
    ExpenseTransaction.find({ ...bm, date: dateMatch, status: { $nin: ['voided', 'reversed'] } }).lean(),
    Order.find({ ...bm, $or: [{ createdAt: dateMatch }, { orderDate: dateMatch }] }).lean(),
    StockMovement.find({ ...bm, $or: [{ movementDate: dateMatch }, { createdAt: dateMatch }] }).lean(),
    SettlementConfirmation.find({ ...bm, businessDate: dateMatch }).lean().catch(() => []),
    StatementUpload.find({ ...bm, createdAt: dateMatch }).lean().catch(() => []),
    OpeningBalance.find({ ...bm }).lean().catch(() => []),
    GeneralLedgerEntry.find({ ...bm, date: dateMatch, status: 'POSTED' }).lean().catch(() => []),
  ]);

  const posRevenue = summaries.reduce((s, r) => s + safeNum(r?.sales?.totalRevenue), 0);
  const posKg = summaries.reduce((s, r) => s + safeNum(r?.sales?.totalKgSold), 0);
  const cashSales = summaries.reduce((s, r) => s + safeNum(r?.sales?.cashAmount), 0);
  const transferSales = summaries.reduce((s, r) => s + safeNum(r?.sales?.transferAmount), 0);
  const posChannelSales = summaries.reduce((s, r) => s + safeNum(r?.sales?.posAmount), 0);

  const deliveredPaidOrders = orders.filter((o) => {
    const status = String(o.status || '').toLowerCase();
    const pay = String(o.paymentStatus || o.payment?.status || '').toLowerCase();
    return status === 'delivered' && (!pay || ['paid', 'success', 'successful', 'completed'].includes(pay));
  });
  const deliveryRevenue = deliveredPaidOrders.reduce((s, o) => s + safeNum(o.grandTotal ?? o.totalAmount ?? o.amount), 0);
  const deliveryKg = deliveredPaidOrders.reduce((s, o) => s + safeNum(o.totalKg ?? o.kg ?? o.quantityKg ?? o.quantity), 0);
  const revenue = posRevenue + deliveryRevenue;
  const kgSold = posKg + deliveryKg;

  const cogs = movements
    .filter((m) => ['SALE_DEPLETION', 'ORDER_DEPLETION', 'COGS', 'STOCK_DEPLETION'].includes(String(m.movementType || m.type || '').toUpperCase()))
    .reduce((s, m) => s + safeNum(m.totalCost ?? m.amount), 0);
  const inventoryValue = movements.reduce((s, m) => {
    const t = String(m.movementType || m.type || '').toUpperCase();
    const value = safeNum(m.totalCost ?? m.amount);
    if (['OPENING_STOCK', 'STOCK_IN', 'PURCHASE', 'ADJUSTMENT_IN'].includes(t)) return s + value;
    if (['SALE_DEPLETION', 'ORDER_DEPLETION', 'COGS', 'STOCK_DEPLETION', 'ADJUSTMENT_OUT'].includes(t)) return s - value;
    return s;
  }, 0);

  const opex = expenses.reduce((s, e) => s + safeNum(e.amount), 0);
  const grossProfit = revenue - cogs;
  const netProfit = grossProfit - opex;
  const monthlyRevenue = revenue / months;
  const monthlyKgSold = kgSold / months;
  const monthlyCogs = cogs / months;
  const monthlyGrossProfit = grossProfit / months;
  const monthlyOpex = opex / months;
  const monthlyNetProfit = netProfit / months;
  const grossMarginPerKg = kgSold > 0 ? grossProfit / kgSold : 0;
  const cogsPerKg = kgSold > 0 ? cogs / kgSold : 0;
  const averageSellingPricePerKg = kgSold > 0 ? revenue / kgSold : 0;

  const glDebit = glEntries.reduce((s, e) => s + safeNum(e?.totals?.debit), 0);
  const glCredit = glEntries.reduce((s, e) => s + safeNum(e?.totals?.credit), 0);
  const glBalanced = Math.abs(glDebit - glCredit) < 1;
  const unpostedSummaries = summaries.filter((s) => !['POSTED'].includes(String(s?.posting?.status || '').toUpperCase()) && String(s.status).toLowerCase() !== 'posted').length;
  const unreviewedSettlements = settlements.filter((s) => ['NOT_REVIEWED', 'PARTIALLY_CONFIRMED', 'VARIANCE_DETECTED'].includes(String(s.status || '').toUpperCase())).length;

  return {
    period: { start, end, months },
    branch: { branchId: branchId || null },
    operating: {
      revenue: round(revenue),
      posRevenue: round(posRevenue),
      deliveryRevenue: round(deliveryRevenue),
      kgSold: round(kgSold, 3),
      cogs: round(cogs),
      grossProfit: round(grossProfit),
      opex: round(opex),
      netProfit: round(netProfit),
      grossMarginPct: revenue > 0 ? round((grossProfit / revenue) * 100, 2) : 0,
      netMarginPct: revenue > 0 ? round((netProfit / revenue) * 100, 2) : 0,
      grossMarginPerKg: round(grossMarginPerKg),
      cogsPerKg: round(cogsPerKg),
      averageSellingPricePerKg: round(averageSellingPricePerKg),
    },
    monthly: {
      revenue: round(monthlyRevenue),
      kgSold: round(monthlyKgSold, 3),
      cogs: round(monthlyCogs),
      grossProfit: round(monthlyGrossProfit),
      opex: round(monthlyOpex),
      netProfit: round(monthlyNetProfit),
      cashAvailableForDebtService: round(monthlyGrossProfit - monthlyOpex),
    },
    cashAndSettlement: {
      cashSales: round(cashSales),
      transferSales: round(transferSales),
      posSales: round(posChannelSales),
      settlementsReviewed: settlements.length - unreviewedSettlements,
      settlementsUnreviewedOrVariant: unreviewedSettlements,
      statementUploads: uploads.length,
    },
    balanceSheet: {
      inventoryValue: round(inventoryValue),
      openingBalancesPosted: openingBalances.filter((o) => ['POSTED', 'posted'].includes(String(o.status))).length,
      assetsEstimated: round(inventoryValue),
      liabilitiesEstimated: 0,
      equityEstimated: round(inventoryValue),
      note: 'Balance sheet is management-account oriented. Bank and external liabilities become stronger after bank statement upload/API integration and loan register posting.',
    },
    controls: {
      summaryCount: summaries.length,
      expenseCount: expenses.length,
      orderCount: orders.length,
      stockMovementCount: movements.length,
      glEntryCount: glEntries.length,
      glBalanced,
      unpostedSummaries,
      unreviewedSettlements,
      hasOpeningBalances: openingBalances.length > 0,
      hasCogs: cogs > 0,
      hasStockMovements: movements.length > 0,
      hasSettlementEvidence: settlements.length > 0 || uploads.length > 0,
    },
  };
};

const calculateMonthlyPayment = ({ amount, annualInterestRate, tenorMonths, moratoriumMonths = 0, repaymentType = 'REDUCING_BALANCE' }) => {
  const principal = safeNum(amount);
  const months = Math.max(1, Math.round(safeNum(tenorMonths, 48)));
  const moratorium = Math.min(Math.max(0, Math.round(safeNum(moratoriumMonths, 0))), months - 1);
  const annualRate = parseRate(annualInterestRate);
  const monthlyRate = annualRate / 12;
  const repaymentMonths = Math.max(1, months - moratorium);

  if (repaymentType === 'FLAT') {
    const totalInterest = principal * annualRate * (months / 12);
    return { monthlyRepayment: (principal + totalInterest) / months, monthlyInterestOnly: principal * monthlyRate, totalInterest };
  }

  if (monthlyRate === 0) {
    return { monthlyRepayment: principal / repaymentMonths, monthlyInterestOnly: 0, totalInterest: 0 };
  }

  const monthlyRepayment = principal * monthlyRate / (1 - Math.pow(1 + monthlyRate, -repaymentMonths));
  return { monthlyRepayment, monthlyInterestOnly: principal * monthlyRate, totalInterest: monthlyRepayment * repaymentMonths - principal };
};

const buildSchedule = ({ amount, annualInterestRate, tenorMonths, moratoriumMonths = 0, repaymentType = 'REDUCING_BALANCE', baseline = {}, truck = {} }) => {
  const principal0 = safeNum(amount);
  const months = Math.max(1, Math.round(safeNum(tenorMonths, 48)));
  const moratorium = Math.min(Math.max(0, Math.round(safeNum(moratoriumMonths, 0))), months - 1);
  const annualRate = parseRate(annualInterestRate);
  const monthlyRate = annualRate / 12;
  const paymentInfo = calculateMonthlyPayment({ amount, annualInterestRate, tenorMonths, moratoriumMonths, repaymentType });
  let outstanding = principal0;
  const schedule = [];
  const baseKg = safeNum(baseline.monthlyKgSold);
  const baseRevenue = safeNum(baseline.monthlyRevenue);
  const baseGrossProfit = safeNum(baseline.monthlyGrossProfit);
  const baseOpex = safeNum(baseline.monthlyOpex);
  const uplift = safeNum(truck.marginUpliftPerKg);
  const volumeGrowth = safeNum(truck.expectedVolumeGrowthPct) / 100;
  const downtime = safeNum(truck.downtimePct) / 100;
  const truckOpex = safeNum(truck.monthlyOperatingCost);
  const start = new Date();

  for (let i = 1; i <= months; i += 1) {
    const d = new Date(start.getFullYear(), start.getMonth() + i - 1, 1);
    const openingPrincipal = outstanding;
    const interest = openingPrincipal * monthlyRate;
    let repayment = 0;
    let principal = 0;

    if (i <= moratorium && repaymentType === 'INTEREST_ONLY_MORATORIUM') {
      repayment = interest;
      principal = 0;
    } else if (i <= moratorium) {
      repayment = 0;
      principal = 0;
      outstanding += interest;
    } else {
      repayment = paymentInfo.monthlyRepayment;
      principal = Math.min(openingPrincipal, Math.max(0, repayment - interest));
      outstanding = Math.max(0, openingPrincipal - principal);
    }

    const projectedKg = baseKg * (1 + volumeGrowth) * (1 - downtime);
    const projectedRevenue = baseRevenue * (1 + volumeGrowth) * (1 - downtime);
    const projectedGrossProfit = baseGrossProfit * (1 + volumeGrowth) * (1 - downtime) + (projectedKg * uplift);
    const projectedOpex = baseOpex;
    const cashAvailableForDebtService = projectedGrossProfit - projectedOpex - truckOpex;
    const dscr = repayment > 0 ? cashAvailableForDebtService / repayment : 999;

    schedule.push({
      month: i,
      periodKey: derivePeriodKey(d),
      openingPrincipal: round(openingPrincipal),
      interest: round(interest),
      principal: round(principal),
      repayment: round(repayment),
      closingPrincipal: round(outstanding),
      projectedKg: round(projectedKg, 3),
      projectedRevenue: round(projectedRevenue),
      projectedGrossProfit: round(projectedGrossProfit),
      projectedOpex: round(projectedOpex),
      truckOpex: round(truckOpex),
      cashAvailableForDebtService: round(cashAvailableForDebtService),
      dscr: dscr === 999 ? 999 : round(dscr, 2),
      netCashAfterDebtService: round(cashAvailableForDebtService - repayment),
    });
  }
  return schedule;
};

const calculateScenario = async (payload = {}) => {
  const baseline = await getActualMonthlyBaseline({
    startDate: payload.startDate,
    endDate: payload.endDate,
    branchId: payload.branchId,
  });

  const loan = {
    amount: safeNum(payload.loanAmount ?? payload.loan?.amount, 60000000),
    annualInterestRate: safeNum(payload.annualInterestRate ?? payload.loan?.annualInterestRate, 15),
    tenorMonths: safeNum(payload.tenorMonths ?? payload.loan?.tenorMonths, 48),
    moratoriumMonths: safeNum(payload.moratoriumMonths ?? payload.loan?.moratoriumMonths, 0),
    fees: safeNum(payload.fees ?? payload.loan?.fees, 0),
    repaymentType: payload.repaymentType || payload.loan?.repaymentType || 'REDUCING_BALANCE',
    lender: payload.lender || payload.loan?.lender || '',
    purpose: payload.purpose || payload.loan?.purpose || 'Truck purchase',
  };
  const currentCost = safeNum(payload.currentBuyingCostPerKg ?? payload.truck?.currentBuyingCostPerKg, baseline.operating.cogsPerKg);
  const marginUplift = safeNum(payload.marginUpliftPerKg ?? payload.truck?.marginUpliftPerKg, 100);
  const truck = {
    assetCost: safeNum(payload.assetCost ?? payload.truck?.assetCost, loan.amount),
    currentBuyingCostPerKg: currentCost,
    newBuyingCostPerKg: safeNum(payload.newBuyingCostPerKg ?? payload.truck?.newBuyingCostPerKg, Math.max(0, currentCost - marginUplift)),
    marginUpliftPerKg: marginUplift,
    monthlyOperatingCost: safeNum(payload.truckMonthlyOperatingCost ?? payload.truck?.monthlyOperatingCost, 0),
    downtimePct: safeNum(payload.downtimePct ?? payload.truck?.downtimePct, 5),
    expectedVolumeGrowthPct: safeNum(payload.expectedVolumeGrowthPct ?? payload.truck?.expectedVolumeGrowthPct, 0),
    usefulLifeMonths: safeNum(payload.usefulLifeMonths ?? payload.truck?.usefulLifeMonths, 60),
  };
  if (!truck.marginUpliftPerKg && truck.currentBuyingCostPerKg && truck.newBuyingCostPerKg) {
    truck.marginUpliftPerKg = Math.max(0, truck.currentBuyingCostPerKg - truck.newBuyingCostPerKg);
  }

  const schedule = buildSchedule({ ...loan, baseline: baseline.monthly, truck });
  const firstPaymentMonth = schedule.find((m) => m.repayment > 0) || schedule[0];
  const monthlyRepayment = safeNum(firstPaymentMonth?.repayment);
  const totalRepayment = schedule.reduce((s, m) => s + safeNum(m.repayment), 0);
  const totalInterest = schedule.reduce((s, m) => s + safeNum(m.interest), 0);
  const cashAvailable = safeNum(firstPaymentMonth?.cashAvailableForDebtService);
  const conservativeCash = (baseline.monthly.grossProfit * 0.8) + (baseline.monthly.kgSold * 0.8 * truck.marginUpliftPerKg) - baseline.monthly.opex - truck.monthlyOperatingCost;
  const growthCash = (baseline.monthly.grossProfit * 1.2) + (baseline.monthly.kgSold * 1.2 * truck.marginUpliftPerKg) - baseline.monthly.opex - truck.monthlyOperatingCost;

  const breakEvenUpliftOnly = truck.marginUpliftPerKg > 0 ? monthlyRepayment / truck.marginUpliftPerKg : 0;
  const breakEvenWithTruckOpex = truck.marginUpliftPerKg > 0 ? (monthlyRepayment + truck.monthlyOperatingCost) / truck.marginUpliftPerKg : 0;
  const baseDscr = monthlyRepayment > 0 ? cashAvailable / monthlyRepayment : 0;
  const conservativeDscr = monthlyRepayment > 0 ? conservativeCash / monthlyRepayment : 0;
  const growthDscr = monthlyRepayment > 0 ? growthCash / monthlyRepayment : 0;

  const sensitivity = {
    conservative: {
      label: '20% lower sales volume',
      cashAvailableForDebtService: round(conservativeCash),
      dscr: round(conservativeDscr, 2),
      netCashAfterDebtService: round(conservativeCash - monthlyRepayment),
    },
    base: {
      label: 'Current sales rate plus truck margin uplift',
      cashAvailableForDebtService: round(cashAvailable),
      dscr: round(baseDscr, 2),
      netCashAfterDebtService: round(cashAvailable - monthlyRepayment),
    },
    growth: {
      label: '20% higher sales volume',
      cashAvailableForDebtService: round(growthCash),
      dscr: round(growthDscr, 2),
      netCashAfterDebtService: round(growthCash - monthlyRepayment),
    },
    margin50: {
      label: 'Truck saves only ₦50/kg',
      kgNeeded: monthlyRepayment / 50,
    },
    margin100: {
      label: 'Truck saves ₦100/kg',
      kgNeeded: monthlyRepayment / 100,
    },
  };

  const readinessScore = computeReadinessScore(baseline, { baseDscr, schedule });

  return {
    scenarioName: payload.scenarioName || 'Truck loan projection',
    branchId: payload.branchId || null,
    loan,
    truck,
    baseline: {
      periodStart: baseline.period.start,
      periodEnd: baseline.period.end,
      monthlyKgSold: round(baseline.monthly.kgSold, 3),
      monthlyRevenue: round(baseline.monthly.revenue),
      monthlyGrossProfit: round(baseline.monthly.grossProfit),
      monthlyOpex: round(baseline.monthly.opex),
      currentGrossMarginPerKg: round(baseline.operating.grossMarginPerKg),
      cashAvailableForDebtService: round(baseline.monthly.cashAvailableForDebtService),
    },
    outputs: {
      monthlyRepayment: round(monthlyRepayment),
      totalRepayment: round(totalRepayment),
      totalInterest: round(totalInterest),
      breakEvenKgFromUpliftOnly: round(breakEvenUpliftOnly, 3),
      breakEvenKgIncludingTruckOpex: round(breakEvenWithTruckOpex, 3),
      dscrBase: round(baseDscr, 2),
      dscrConservative: round(conservativeDscr, 2),
      dscrGrowth: round(growthDscr, 2),
      repaymentHeadroom: round(cashAvailable - monthlyRepayment),
      readinessScore,
    },
    sensitivity,
    schedule,
    assumptions: {
      note: 'Projection is a management analysis. Final lender schedule depends on actual offer letter, fees, moratorium and repayment terms.',
      dscrTarget: 1.25,
    },
    managementAccounts: baseline,
  };
};

function computeReadinessScore(baseline, projection = {}) {
  const checks = buildReadinessChecklist(baseline, projection);
  const weight = checks.reduce((s, c) => s + c.weight, 0);
  const earned = checks.reduce((s, c) => s + (c.status === 'PASS' ? c.weight : c.status === 'WARN' ? c.weight * 0.5 : 0), 0);
  return Math.round((earned / Math.max(1, weight)) * 100);
}

function buildReadinessChecklist(baseline, projection = {}) {
  const dscr = safeNum(projection.baseDscr ?? projection?.outputs?.dscrBase, 0);
  return [
    { key: 'sales_history', label: 'Sales history available', status: baseline.controls.summaryCount > 0 || baseline.controls.orderCount > 0 ? 'PASS' : 'FAIL', weight: 15, recommendation: 'Ensure at least 6 months POS/order data is captured.' },
    { key: 'stock_cogs', label: 'Inventory and COGS active', status: baseline.controls.hasCogs && baseline.controls.hasStockMovements ? 'PASS' : baseline.controls.hasStockMovements ? 'WARN' : 'FAIL', weight: 15, recommendation: 'Initialize stock, log stock-ins and confirm COGS depletion from sales.' },
    { key: 'opening_balances', label: 'Opening balances posted', status: baseline.controls.hasOpeningBalances ? 'PASS' : 'WARN', weight: 10, recommendation: 'Post opening cash, bank, inventory, payables/receivables and equity.' },
    { key: 'gl_integrity', label: 'GL entries balanced', status: baseline.controls.glBalanced && baseline.controls.glEntryCount > 0 ? 'PASS' : baseline.controls.glEntryCount > 0 ? 'FAIL' : 'WARN', weight: 15, recommendation: 'Run GL health and clear unbalanced postings.' },
    { key: 'unposted_sales', label: 'Approved days posted to GL', status: baseline.controls.unpostedSummaries === 0 ? 'PASS' : 'WARN', weight: 10, recommendation: 'Post approved daily summaries before lender pack extraction.' },
    { key: 'settlement_evidence', label: 'Cash/POS/bank settlement evidence available', status: baseline.controls.hasSettlementEvidence ? 'PASS' : 'WARN', weight: 10, recommendation: 'Use manual settlement confirmation or statement upload before lender review.' },
    { key: 'profitability', label: 'Positive monthly cash available for debt service', status: baseline.monthly.cashAvailableForDebtService > 0 ? 'PASS' : 'FAIL', weight: 10, recommendation: 'Reduce OPEX, improve margin or increase volume before taking debt.' },
    { key: 'dscr', label: 'DSCR meets minimum lender comfort', status: dscr >= 1.25 ? 'PASS' : dscr > 0 ? 'WARN' : 'FAIL', weight: 15, recommendation: 'Target DSCR of at least 1.25x under base case and near 1.0x under stress case.' },
  ];
}

const getLoanReadiness = async (query = {}) => {
  const baseline = await getActualMonthlyBaseline(query);
  const quickScenario = await calculateScenario({ ...query, loanAmount: query.loanAmount || 60000000, tenorMonths: query.tenorMonths || 48, annualInterestRate: query.annualInterestRate || 15 });
  const checklist = buildReadinessChecklist(baseline, quickScenario.outputs);
  return {
    score: computeReadinessScore(baseline, quickScenario.outputs),
    checklist,
    summary: {
      monthlyKgSold: baseline.monthly.kgSold,
      monthlyRevenue: baseline.monthly.revenue,
      monthlyGrossProfit: baseline.monthly.grossProfit,
      monthlyOpex: baseline.monthly.opex,
      currentGrossMarginPerKg: baseline.operating.grossMarginPerKg,
      sampleMonthlyRepayment: quickScenario.outputs.monthlyRepayment,
      sampleBaseDscr: quickScenario.outputs.dscrBase,
      sampleBreakEvenKgAt100: quickScenario.sensitivity.margin100.kgNeeded,
      sampleBreakEvenKgAt50: quickScenario.sensitivity.margin50.kgNeeded,
    },
  };
};

module.exports = {
  safeNum,
  round,
  parseDateRange,
  getActualMonthlyBaseline,
  calculateScenario,
  getLoanReadiness,
};
