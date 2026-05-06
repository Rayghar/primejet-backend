// File: src/models/truckTrip.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const toNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const round = (n, dp = 2) => Math.round(toNum(n) * 10 ** dp) / 10 ** dp;

const tripCostSchema = new mongoose.Schema(
  {
    id: { type: String, default: () => uuidv4() },
    category: {
      type: String,
      enum: ['DIESEL', 'DRIVER_ALLOWANCE', 'ASSISTANT_ALLOWANCE', 'TOLL', 'SECURITY', 'LOADING_CHARGE', 'UNION_FEE', 'MAINTENANCE', 'PARKING', 'MISCELLANEOUS'],
      default: 'MISCELLANEOUS',
    },
    description: { type: String, trim: true, maxlength: 300 },
    amount: { type: Number, default: 0, min: 0 },
    treatment: { type: String, enum: ['CAPITALISE', 'EXPENSE', 'SPLIT'], default: 'CAPITALISE' },
    capitalisedRatioPct: { type: Number, default: 100, min: 0, max: 100 },
    paidBy: { type: String, trim: true },
    paymentMethod: { type: String, trim: true },
    incurredAt: { type: Date, default: Date.now },
    notes: { type: String, trim: true, maxlength: 500 },
  },
  { _id: false }
);

const offloadSchema = new mongoose.Schema(
  {
    id: { type: String, default: () => uuidv4(), index: true },
    destinationType: {
      type: String,
      enum: ['BRANCH', 'CORPORATE_CLIENT', 'RESELLER', 'BULK_CUSTOMER', 'OTHER'],
      default: 'BRANCH',
      index: true,
    },
    destinationId: { type: String, trim: true, index: true },
    destinationName: { type: String, trim: true },
    branchId: { type: String, trim: true, index: true },
    branchName: { type: String, trim: true },
    corporateClientId: { type: String, trim: true, index: true },
    corporateClientName: { type: String, trim: true },
    fulfilmentId: { type: String, trim: true, index: true, sparse: true },
    requestedKg: { type: Number, default: 0, min: 0 },
    deliveredKg: { type: Number, default: 0, min: 0 },
    receivedKg: { type: Number, default: 0, min: 0 },
    sellingPricePerKg: { type: Number, default: 0, min: 0 },
    deliveryCost: { type: Number, default: 0, min: 0 },
    deliveryAddress: { type: String, trim: true, maxlength: 500 },
    offloadedAt: { type: Date, default: Date.now, index: true },
    receiptStatus: {
      type: String,
      enum: ['PENDING', 'CONFIRMED', 'DISPUTED', 'REJECTED'],
      default: 'PENDING',
      index: true,
    },
    customerConfirmed: { type: Boolean, default: false },
    confirmedBy: { type: String, trim: true },
    confirmedAt: { type: Date },
    stockInReference: { type: String, trim: true, index: true, sparse: true },
    waybillReference: { type: String, trim: true },
    notes: { type: String, trim: true, maxlength: 1000 },
  },
  { _id: false }
);

const economicsSchema = new mongoose.Schema(
  {
    purchaseCost: { type: Number, default: 0 },
    totalTripCost: { type: Number, default: 0 },
    capitalisedTripCost: { type: Number, default: 0 },
    expenseOnlyTripCost: { type: Number, default: 0 },
    landedCostBasis: { type: Number, default: 0 },
    loadedKg: { type: Number, default: 0 },
    deliveredKg: { type: Number, default: 0 },
    internalDeliveredKg: { type: Number, default: 0 },
    externalDeliveredKg: { type: Number, default: 0 },
    expectedBalanceKg: { type: Number, default: 0 },
    actualBalanceKg: { type: Number, default: 0 },
    varianceKg: { type: Number, default: 0 },
    variancePct: { type: Number, default: 0 },
    landedCostPerKg: { type: Number, default: 0 },
    costPerKgTransported: { type: Number, default: 0 },
    externalRevenue: { type: Number, default: 0 },
    externalCogs: { type: Number, default: 0 },
    externalGrossProfit: { type: Number, default: 0 },
    externalMarginPerKg: { type: Number, default: 0 },
    internalTransferValue: { type: Number, default: 0 },
    directTruckProfit: { type: Number, default: 0 },
    groupContributionBeforeFixedCost: { type: Number, default: 0 },
    loanRepaymentImpact: { type: Number, default: 0 },
    depreciationImpact: { type: Number, default: 0 },
    fixedCostImpact: { type: Number, default: 0 },
    netContributionAfterFixedCost: { type: Number, default: 0 },
    utilizationPct: { type: Number, default: 0 },
    fuelCostPerKg: { type: Number, default: 0 },
  },
  { _id: false }
);

const truckTripSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4(), index: true },
    tripCode: { type: String, trim: true, uppercase: true, index: true },
    truckId: { type: String, required: true, index: true },
    truckName: { type: String, trim: true, index: true },
    plateNumber: { type: String, trim: true, uppercase: true },
    capacityKg: { type: Number, default: 0, min: 0 },
    ownershipType: { type: String, trim: true },
    monthlyRepayment: { type: Number, default: 0, min: 0 },
    monthlyDepreciation: { type: Number, default: 0, min: 0 },
    fixedCostAllocation: { type: Number, default: 0, min: 0 },
    tripType: {
      type: String,
      enum: ['REFINERY_OFFTAKE', 'SUPPLIER_PICKUP', 'BRANCH_SUPPLY', 'CORPORATE_DELIVERY', 'MIXED_DROP', 'OTHER'],
      default: 'REFINERY_OFFTAKE',
      index: true,
    },
    sourceType: { type: String, enum: ['REFINERY', 'SUPPLIER', 'DEPOT', 'BRANCH', 'OTHER'], default: 'SUPPLIER' },
    sourceName: { type: String, trim: true, index: true },
    plannedDepartureAt: { type: Date, index: true },
    loadingStartedAt: { type: Date },
    loadedAt: { type: Date, index: true },
    departedAt: { type: Date },
    completedAt: { type: Date },
    closedAt: { type: Date },
    status: {
      type: String,
      enum: ['PLANNED', 'LOADING', 'LOADED', 'IN_TRANSIT', 'PARTIALLY_OFFLOADED', 'COMPLETED', 'CLOSED', 'UNDER_REVIEW', 'CANCELLED'],
      default: 'PLANNED',
      index: true,
    },
    expectedKg: { type: Number, default: 0, min: 0 },
    loadedKg: { type: Number, default: 0, min: 0 },
    purchasePricePerKg: { type: Number, default: 0, min: 0 },
    purchaseCost: { type: Number, default: 0, min: 0 },
    loadingTicketNumber: { type: String, trim: true, index: true },
    waybillNumber: { type: String, trim: true, index: true },
    supplierInvoiceNumber: { type: String, trim: true },
    driverId: { type: String, trim: true, index: true },
    driverName: { type: String, trim: true },
    assistantName: { type: String, trim: true },
    startingOdometerKm: { type: Number, default: 0, min: 0 },
    endingOdometerKm: { type: Number, default: 0, min: 0 },
    kmTravelled: { type: Number, default: 0, min: 0 },
    costs: { type: [tripCostSchema], default: [] },
    offloads: { type: [offloadSchema], default: [] },
    economics: { type: economicsSchema, default: () => ({}) },
    reviewFlags: { type: [String], default: [] },
    notes: { type: String, trim: true, maxlength: 2000 },
    createdBy: { type: String, trim: true },
    updatedBy: { type: String, trim: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

truckTripSchema.index({ truckId: 1, createdAt: -1 });
truckTripSchema.index({ status: 1, plannedDepartureAt: -1 });
truckTripSchema.index({ 'offloads.destinationType': 1, 'offloads.destinationId': 1 });
truckTripSchema.index({ tripCode: 'text', truckName: 'text', plateNumber: 'text', sourceName: 'text', waybillNumber: 'text' });

const isExternalOffload = (offload) => ['CORPORATE_CLIENT', 'RESELLER', 'BULK_CUSTOMER', 'OTHER'].includes(offload.destinationType);
const isInternalOffload = (offload) => offload.destinationType === 'BRANCH';

truckTripSchema.methods.recalculateEconomics = function () {
  const loadedKg = toNum(this.loadedKg);
  const purchaseCost = toNum(this.purchaseCost) || loadedKg * toNum(this.purchasePricePerKg);
  this.purchaseCost = round(purchaseCost);

  const costs = Array.isArray(this.costs) ? this.costs : [];
  const offloads = Array.isArray(this.offloads) ? this.offloads : [];
  const totalTripCost = costs.reduce((sum, c) => sum + toNum(c.amount), 0);
  const capitalisedTripCost = costs.reduce((sum, c) => {
    if (c.treatment === 'EXPENSE') return sum;
    if (c.treatment === 'SPLIT') return sum + toNum(c.amount) * (toNum(c.capitalisedRatioPct, 0) / 100);
    return sum + toNum(c.amount);
  }, 0);
  const expenseOnlyTripCost = totalTripCost - capitalisedTripCost;
  const deliveredKg = offloads.reduce((sum, o) => sum + toNum(o.deliveredKg || o.receivedKg), 0);
  const internalDeliveredKg = offloads.filter(isInternalOffload).reduce((sum, o) => sum + toNum(o.deliveredKg || o.receivedKg), 0);
  const externalDeliveredKg = offloads.filter(isExternalOffload).reduce((sum, o) => sum + toNum(o.deliveredKg || o.receivedKg), 0);
  const landedCostBasis = purchaseCost + capitalisedTripCost;
  const landedCostPerKg = deliveredKg > 0 ? landedCostBasis / deliveredKg : loadedKg > 0 ? landedCostBasis / loadedKg : 0;
  const costPerKgTransported = deliveredKg > 0 ? totalTripCost / deliveredKg : 0;
  const externalRevenue = offloads.filter(isExternalOffload).reduce((sum, o) => sum + toNum(o.deliveredKg || o.receivedKg) * toNum(o.sellingPricePerKg), 0);
  const externalDeliveryCost = offloads.filter(isExternalOffload).reduce((sum, o) => sum + toNum(o.deliveryCost), 0);
  const externalCogs = externalDeliveredKg * landedCostPerKg + externalDeliveryCost;
  const externalGrossProfit = externalRevenue - externalCogs;
  const externalMarginPerKg = externalDeliveredKg > 0 ? externalGrossProfit / externalDeliveredKg : 0;
  const internalTransferValue = internalDeliveredKg * landedCostPerKg;
  const directTruckProfit = externalGrossProfit - expenseOnlyTripCost;
  const groupContributionBeforeFixedCost = externalGrossProfit + internalTransferValue - landedCostBasis - expenseOnlyTripCost;
  const expectedBalanceKg = Math.max(loadedKg - deliveredKg, 0);
  const actualBalanceKg = expectedBalanceKg;
  const varianceKg = round(loadedKg - deliveredKg - actualBalanceKg);
  const variancePct = loadedKg > 0 ? (varianceKg / loadedKg) * 100 : 0;
  const fixedCostImpact = toNum(this.fixedCostAllocation);
  const loanRepaymentImpact = toNum(this.monthlyRepayment);
  const depreciationImpact = toNum(this.monthlyDepreciation);
  const netContributionAfterFixedCost = directTruckProfit - fixedCostImpact;
  const utilizationPct = toNum(this.capacityKg) > 0 ? (loadedKg / toNum(this.capacityKg)) * 100 : 0;
  const dieselCost = costs.filter((c) => c.category === 'DIESEL').reduce((sum, c) => sum + toNum(c.amount), 0);
  const fuelCostPerKg = deliveredKg > 0 ? dieselCost / deliveredKg : 0;

  this.economics = {
    purchaseCost: round(purchaseCost),
    totalTripCost: round(totalTripCost),
    capitalisedTripCost: round(capitalisedTripCost),
    expenseOnlyTripCost: round(expenseOnlyTripCost),
    landedCostBasis: round(landedCostBasis),
    loadedKg: round(loadedKg),
    deliveredKg: round(deliveredKg),
    internalDeliveredKg: round(internalDeliveredKg),
    externalDeliveredKg: round(externalDeliveredKg),
    expectedBalanceKg: round(expectedBalanceKg),
    actualBalanceKg: round(actualBalanceKg),
    varianceKg: round(varianceKg),
    variancePct: round(variancePct),
    landedCostPerKg: round(landedCostPerKg),
    costPerKgTransported: round(costPerKgTransported),
    externalRevenue: round(externalRevenue),
    externalCogs: round(externalCogs),
    externalGrossProfit: round(externalGrossProfit),
    externalMarginPerKg: round(externalMarginPerKg),
    internalTransferValue: round(internalTransferValue),
    directTruckProfit: round(directTruckProfit),
    groupContributionBeforeFixedCost: round(groupContributionBeforeFixedCost),
    loanRepaymentImpact: round(loanRepaymentImpact),
    depreciationImpact: round(depreciationImpact),
    fixedCostImpact: round(fixedCostImpact),
    netContributionAfterFixedCost: round(netContributionAfterFixedCost),
    utilizationPct: round(utilizationPct),
    fuelCostPerKg: round(fuelCostPerKg),
  };

  const flags = [];
  if (loadedKg > 0 && deliveredKg > loadedKg) flags.push('OFFLOAD_EXCEEDS_LOADED_KG');
  if (loadedKg > 0 && Math.abs(variancePct) > 0.5) flags.push('MATERIAL_TRIP_VARIANCE');
  if (loadedKg > 0 && utilizationPct < 60) flags.push('LOW_CAPACITY_UTILISATION');
  if (externalRevenue > 0 && externalGrossProfit < 0) flags.push('NEGATIVE_EXTERNAL_MARGIN');
  this.reviewFlags = flags;
  return this.economics;
};

truckTripSchema.pre('validate', function (next) {
  if (!this.tripCode) {
    const date = new Date(this.plannedDepartureAt || this.createdAt || Date.now());
    const ymd = date.toISOString().slice(0, 10).replace(/-/g, '');
    this.tripCode = `TRIP-${ymd}-${String(this.id || uuidv4()).slice(0, 5).toUpperCase()}`;
  }
  if (!this.purchaseCost && this.loadedKg && this.purchasePricePerKg) this.purchaseCost = toNum(this.loadedKg) * toNum(this.purchasePricePerKg);
  if (!this.kmTravelled && this.endingOdometerKm && this.startingOdometerKm) {
    this.kmTravelled = Math.max(toNum(this.endingOdometerKm) - toNum(this.startingOdometerKm), 0);
  }
  this.recalculateEconomics();
  next();
});

module.exports = mongoose.models.TruckTrip || mongoose.model('TruckTrip', truckTripSchema);
