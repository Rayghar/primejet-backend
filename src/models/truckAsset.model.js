// File: src/models/truckAsset.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const toNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const truckAssetSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4(), index: true },
    truckCode: { type: String, trim: true, uppercase: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120, index: true },
    plateNumber: { type: String, trim: true, uppercase: true, maxlength: 40, index: true },
    capacityKg: { type: Number, default: 0, min: 0 },
    ownershipType: {
      type: String,
      enum: ['OWNED', 'LEASED', 'FINANCED', 'THIRD_PARTY'],
      default: 'OWNED',
      index: true,
    },
    acquisitionCost: { type: Number, default: 0, min: 0 },
    loanAmount: { type: Number, default: 0, min: 0 },
    monthlyRepayment: { type: Number, default: 0, min: 0 },
    interestRatePct: { type: Number, default: 0, min: 0 },
    loanTenorMonths: { type: Number, default: 0, min: 0 },
    usefulLifeYears: { type: Number, default: 5, min: 0 },
    insuranceAnnualCost: { type: Number, default: 0, min: 0 },
    licensingAnnualCost: { type: Number, default: 0, min: 0 },
    maintenanceReserveMonthly: { type: Number, default: 0, min: 0 },
    expectedMonthlyTrips: { type: Number, default: 0, min: 0 },
    expectedMonthlyKg: { type: Number, default: 0, min: 0 },
    targetGrossMarginPerKg: { type: Number, default: 0 },
    defaultDriverId: { type: String, trim: true, index: true, sparse: true },
    defaultDriverName: { type: String, trim: true },
    defaultAssistantName: { type: String, trim: true },
    homeBranchId: { type: String, trim: true, index: true, sparse: true },
    homeBranchName: { type: String, trim: true },
    status: {
      type: String,
      enum: ['ACTIVE', 'IDLE', 'IN_TRANSIT', 'MAINTENANCE', 'OFFLINE', 'RETIRED'],
      default: 'ACTIVE',
      index: true,
    },
    currentTripId: { type: String, trim: true, index: true, sparse: true },
    notes: { type: String, trim: true, maxlength: 2000 },
    createdBy: { type: String, trim: true },
    updatedBy: { type: String, trim: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

truckAssetSchema.index({ status: 1, ownershipType: 1 });
truckAssetSchema.index({ name: 'text', plateNumber: 'text', truckCode: 'text' });

truckAssetSchema.virtual('monthlyDepreciation').get(function () {
  const lifeMonths = Math.max(toNumber(this.usefulLifeYears) * 12, 1);
  return toNumber(this.acquisitionCost) > 0 ? toNumber(this.acquisitionCost) / lifeMonths : 0;
});

truckAssetSchema.virtual('fixedMonthlyCost').get(function () {
  return (
    toNumber(this.monthlyRepayment) +
    toNumber(this.maintenanceReserveMonthly) +
    toNumber(this.insuranceAnnualCost) / 12 +
    toNumber(this.licensingAnnualCost) / 12 +
    (toNumber(this.acquisitionCost) > 0 ? toNumber(this.acquisitionCost) / Math.max(toNumber(this.usefulLifeYears) * 12, 1) : 0)
  );
});

truckAssetSchema.pre('validate', function (next) {
  if (!this.truckCode && this.name) {
    const base = String(this.name).replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase() || 'TRUCK';
    this.truckCode = `${base}-${String(this.id || uuidv4()).slice(0, 4).toUpperCase()}`;
  }
  next();
});

module.exports = mongoose.models.TruckAsset || mongoose.model('TruckAsset', truckAssetSchema);
