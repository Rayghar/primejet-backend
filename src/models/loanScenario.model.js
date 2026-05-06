// src/models/loanScenario.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const monthlyProjectionSchema = new mongoose.Schema(
  {
    month: Number,
    periodKey: String,
    openingPrincipal: Number,
    interest: Number,
    principal: Number,
    repayment: Number,
    closingPrincipal: Number,
    projectedKg: Number,
    projectedRevenue: Number,
    projectedGrossProfit: Number,
    projectedOpex: Number,
    truckOpex: Number,
    cashAvailableForDebtService: Number,
    dscr: Number,
    netCashAfterDebtService: Number,
  },
  { _id: false }
);

const loanScenarioSchema = new mongoose.Schema(
  {
    id: { type: String, default: () => uuidv4(), unique: true, index: true },
    scenarioName: { type: String, required: true, trim: true, maxlength: 160 },
    branchId: { type: String, default: null, index: true },
    status: {
      type: String,
      enum: ['DRAFT', 'REVIEWED', 'APPROVED_FOR_LENDER_PACK', 'ARCHIVED'],
      default: 'DRAFT',
      index: true,
    },
    loan: {
      amount: { type: Number, required: true, min: 0 },
      annualInterestRate: { type: Number, default: 0 },
      tenorMonths: { type: Number, required: true, min: 1 },
      moratoriumMonths: { type: Number, default: 0, min: 0 },
      fees: { type: Number, default: 0, min: 0 },
      repaymentType: { type: String, enum: ['REDUCING_BALANCE', 'FLAT', 'INTEREST_ONLY_MORATORIUM'], default: 'REDUCING_BALANCE' },
      lender: { type: String, default: null },
      purpose: { type: String, default: 'Truck purchase' },
    },
    truck: {
      assetCost: { type: Number, default: 0 },
      currentBuyingCostPerKg: { type: Number, default: 0 },
      newBuyingCostPerKg: { type: Number, default: 0 },
      marginUpliftPerKg: { type: Number, default: 0 },
      monthlyOperatingCost: { type: Number, default: 0 },
      downtimePct: { type: Number, default: 0 },
      expectedVolumeGrowthPct: { type: Number, default: 0 },
      usefulLifeMonths: { type: Number, default: 60 },
    },
    baseline: {
      periodStart: Date,
      periodEnd: Date,
      monthlyKgSold: { type: Number, default: 0 },
      monthlyRevenue: { type: Number, default: 0 },
      monthlyGrossProfit: { type: Number, default: 0 },
      monthlyOpex: { type: Number, default: 0 },
      currentGrossMarginPerKg: { type: Number, default: 0 },
      cashAvailableForDebtService: { type: Number, default: 0 },
    },
    outputs: {
      monthlyRepayment: { type: Number, default: 0 },
      totalRepayment: { type: Number, default: 0 },
      totalInterest: { type: Number, default: 0 },
      breakEvenKgFromUpliftOnly: { type: Number, default: 0 },
      breakEvenKgIncludingTruckOpex: { type: Number, default: 0 },
      dscrBase: { type: Number, default: 0 },
      dscrConservative: { type: Number, default: 0 },
      dscrGrowth: { type: Number, default: 0 },
      repaymentHeadroom: { type: Number, default: 0 },
      readinessScore: { type: Number, default: 0 },
    },
    sensitivity: { type: mongoose.Schema.Types.Mixed, default: {} },
    schedule: { type: [monthlyProjectionSchema], default: [] },
    assumptions: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdBy: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('LoanScenario', loanScenarioSchema);
