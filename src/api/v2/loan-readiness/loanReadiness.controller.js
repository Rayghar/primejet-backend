// src/api/v2/loan-readiness/loanReadiness.controller.js
const { Parser } = require('json2csv');
const HttpError = require('../../../utils/HttpError');
const LoanScenario = require('../../../models/loanScenario.model');
const {
  getActualMonthlyBaseline,
  calculateScenario,
  getLoanReadiness,
  round,
} = require('./loanReadiness.service');

const userName = (req) => req.user?.name || req.user?.email || req.user?.id || 'system';

const getManagementAccounts = async (req, res, next) => {
  try {
    const accounts = await getActualMonthlyBaseline(req.query || {});
    return res.json({ ok: true, accounts, guide: { title: 'Management Accounts', message: 'Use this pack to review lender-facing monthly revenue, COGS, gross profit, OPEX, cash/settlement status, inventory valuation and GL readiness.' } });
  } catch (error) {
    return next(error instanceof HttpError ? error : new HttpError(500, error.message || 'Failed to load management accounts.'));
  }
};

const getReadiness = async (req, res, next) => {
  try {
    const readiness = await getLoanReadiness(req.query || {});
    return res.json({ ok: true, readiness });
  } catch (error) {
    return next(error instanceof HttpError ? error : new HttpError(500, error.message || 'Failed to load loan readiness.'));
  }
};

const calculateLoanScenario = async (req, res, next) => {
  try {
    const scenario = await calculateScenario({ ...(req.query || {}), ...(req.body || {}) });
    return res.json({ ok: true, scenario });
  } catch (error) {
    return next(error instanceof HttpError ? error : new HttpError(500, error.message || 'Failed to calculate loan scenario.'));
  }
};

const createLoanScenario = async (req, res, next) => {
  try {
    const scenarioPayload = await calculateScenario(req.body || {});
    const scenario = await LoanScenario.create({ ...scenarioPayload, createdBy: userName(req) });
    return res.status(201).json({ ok: true, scenario, message: 'Loan projection scenario saved.' });
  } catch (error) {
    return next(error instanceof HttpError ? error : new HttpError(500, error.message || 'Failed to save loan scenario.'));
  }
};

const listLoanScenarios = async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit || 50), 200);
    const filter = {};
    if (req.query.branchId) filter.branchId = String(req.query.branchId);
    const scenarios = await LoanScenario.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
    return res.json({ ok: true, scenarios });
  } catch (error) {
    return next(new HttpError(500, 'Failed to list loan scenarios.'));
  }
};

const getLoanScenario = async (req, res, next) => {
  try {
    const scenario = await LoanScenario.findOne({ $or: [{ id: req.params.scenarioId }, { _id: req.params.scenarioId }] }).lean();
    if (!scenario) throw new HttpError(404, 'Loan scenario not found.');
    return res.json({ ok: true, scenario });
  } catch (error) {
    return next(error instanceof HttpError ? error : new HttpError(500, 'Failed to load loan scenario.'));
  }
};

const updateLoanScenarioStatus = async (req, res, next) => {
  try {
    const { status } = req.body || {};
    const allowed = ['DRAFT', 'REVIEWED', 'APPROVED_FOR_LENDER_PACK', 'ARCHIVED'];
    if (!allowed.includes(String(status))) throw new HttpError(400, 'Invalid loan scenario status.');
    const scenario = await LoanScenario.findOneAndUpdate(
      { $or: [{ id: req.params.scenarioId }, { _id: req.params.scenarioId }] },
      { $set: { status } },
      { new: true }
    ).lean();
    if (!scenario) throw new HttpError(404, 'Loan scenario not found.');
    return res.json({ ok: true, scenario, message: 'Scenario status updated.' });
  } catch (error) {
    return next(error instanceof HttpError ? error : new HttpError(500, 'Failed to update scenario status.'));
  }
};

const getTruckEconomics = async (req, res, next) => {
  try {
    const scenario = await calculateScenario({ ...(req.query || {}), ...(req.body || {}) });
    const output = {
      loan: scenario.loan,
      truck: scenario.truck,
      baseline: scenario.baseline,
      repayment: scenario.outputs,
      sensitivity: scenario.sensitivity,
      interpretation: {
        canRepayBaseCase: scenario.outputs.dscrBase >= 1.25,
        canRepayConservativeCase: scenario.outputs.dscrConservative >= 1,
        monthlyNetBenefitBeforeDebt: round(
          (scenario.baseline.monthlyKgSold * scenario.truck.marginUpliftPerKg) - scenario.truck.monthlyOperatingCost
        ),
        paybackMonthsFromIncrementalBenefit: ((scenario.baseline.monthlyKgSold * scenario.truck.marginUpliftPerKg) - scenario.truck.monthlyOperatingCost) > 0
          ? round(scenario.loan.amount / ((scenario.baseline.monthlyKgSold * scenario.truck.marginUpliftPerKg) - scenario.truck.monthlyOperatingCost), 1)
          : null,
      },
    };
    return res.json({ ok: true, truckEconomics: output });
  } catch (error) {
    return next(error instanceof HttpError ? error : new HttpError(500, error.message || 'Failed to load truck economics.'));
  }
};

const getFundingPack = async (req, res, next) => {
  try {
    const accounts = await getActualMonthlyBaseline(req.query || {});
    let scenario = null;
    if (req.query.scenarioId) {
      scenario = await LoanScenario.findOne({ $or: [{ id: req.query.scenarioId }, { _id: req.query.scenarioId }] }).lean();
    }
    if (!scenario) {
      scenario = await calculateScenario(req.query || {});
    }
    const readiness = await getLoanReadiness(req.query || {});
    return res.json({
      ok: true,
      fundingPack: {
        generatedAt: new Date(),
        borrower: { businessName: 'PrimeJet / Gas2Door', sector: 'LPG retail and last-mile delivery' },
        managementAccounts: accounts,
        loanProjection: scenario,
        readiness,
        lenderSummary: {
          monthlyRevenue: accounts.monthly.revenue,
          monthlyKgSold: accounts.monthly.kgSold,
          grossMarginPerKg: accounts.operating.grossMarginPerKg,
          proposedLoanAmount: scenario.loan?.amount,
          proposedMonthlyRepayment: scenario.outputs?.monthlyRepayment,
          baseDscr: scenario.outputs?.dscrBase,
          conservativeDscr: scenario.outputs?.dscrConservative,
          recommendation: scenario.outputs?.dscrBase >= 1.25 ? 'Base-case repayment capacity appears acceptable; validate settlement and bank statements before submission.' : 'Base-case repayment capacity needs improvement before lender submission.',
        },
      },
    });
  } catch (error) {
    return next(error instanceof HttpError ? error : new HttpError(500, error.message || 'Failed to generate funding pack.'));
  }
};

const exportLoanSchedule = async (req, res, next) => {
  try {
    let scenario = null;
    if (req.params.scenarioId) {
      scenario = await LoanScenario.findOne({ $or: [{ id: req.params.scenarioId }, { _id: req.params.scenarioId }] }).lean();
    }
    if (!scenario) scenario = await calculateScenario({ ...(req.query || {}), ...(req.body || {}) });
    const rows = (scenario.schedule || []).map((m) => ({
      Month: m.month,
      Period: m.periodKey,
      OpeningPrincipal: m.openingPrincipal,
      Interest: m.interest,
      Principal: m.principal,
      Repayment: m.repayment,
      ClosingPrincipal: m.closingPrincipal,
      ProjectedKg: m.projectedKg,
      ProjectedRevenue: m.projectedRevenue,
      ProjectedGrossProfit: m.projectedGrossProfit,
      Opex: m.projectedOpex,
      TruckOpex: m.truckOpex,
      CashAvailableForDebtService: m.cashAvailableForDebtService,
      DSCR: m.dscr,
      NetCashAfterDebtService: m.netCashAfterDebtService,
    }));
    const csv = new Parser().parse(rows);
    res.header('Content-Type', 'text/csv');
    res.attachment(`loan-repayment-schedule-${Date.now()}.csv`);
    return res.send(csv);
  } catch (error) {
    return next(error instanceof HttpError ? error : new HttpError(500, 'Failed to export loan schedule.'));
  }
};

const exportFundingPack = async (req, res, next) => {
  try {
    const accounts = await getActualMonthlyBaseline(req.query || {});
    const scenario = req.query.scenarioId
      ? await LoanScenario.findOne({ $or: [{ id: req.query.scenarioId }, { _id: req.query.scenarioId }] }).lean()
      : await calculateScenario(req.query || {});
    const readiness = await getLoanReadiness(req.query || {});
    const rows = [
      { Section: 'Management Accounts', Metric: 'Monthly Revenue', Value: accounts.monthly.revenue },
      { Section: 'Management Accounts', Metric: 'Monthly Kg Sold', Value: accounts.monthly.kgSold },
      { Section: 'Management Accounts', Metric: 'Monthly Gross Profit', Value: accounts.monthly.grossProfit },
      { Section: 'Management Accounts', Metric: 'Monthly OPEX', Value: accounts.monthly.opex },
      { Section: 'Management Accounts', Metric: 'Gross Margin / Kg', Value: accounts.operating.grossMarginPerKg },
      { Section: 'Loan', Metric: 'Loan Amount', Value: scenario?.loan?.amount },
      { Section: 'Loan', Metric: 'Monthly Repayment', Value: scenario?.outputs?.monthlyRepayment },
      { Section: 'Loan', Metric: 'Base DSCR', Value: scenario?.outputs?.dscrBase },
      { Section: 'Loan', Metric: 'Conservative DSCR', Value: scenario?.outputs?.dscrConservative },
      { Section: 'Readiness', Metric: 'Score', Value: readiness.score },
      ...readiness.checklist.map((c) => ({ Section: 'Readiness Checklist', Metric: c.label, Value: c.status, Recommendation: c.recommendation })),
    ];
    const csv = new Parser().parse(rows);
    res.header('Content-Type', 'text/csv');
    res.attachment(`funding-pack-summary-${Date.now()}.csv`);
    return res.send(csv);
  } catch (error) {
    return next(error instanceof HttpError ? error : new HttpError(500, 'Failed to export funding pack.'));
  }
};

module.exports = {
  getManagementAccounts,
  getReadiness,
  calculateLoanScenario,
  createLoanScenario,
  listLoanScenarios,
  getLoanScenario,
  updateLoanScenarioStatus,
  getTruckEconomics,
  getFundingPack,
  exportLoanSchedule,
  exportFundingPack,
};
