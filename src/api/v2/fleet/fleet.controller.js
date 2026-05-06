// File: src/api/v2/fleet/fleet.controller.js
const TruckAsset = require('../../../models/truckAsset.model');
const TruckTrip = require('../../../models/truckTrip.model');
const CorporateFulfilment = require('../../../models/corporateFulfilment.model');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');

const toNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const round = (n, dp = 2) => Math.round(toNum(n) * 10 ** dp) / 10 ** dp;
const arr = (v) => (Array.isArray(v) ? v : []);
const escapeRegex = (s = '') => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const now = () => new Date();
const asDate = (v) => (v === '' || v === null || v === undefined ? undefined : v);

const readRoles = ['admin', 'owner', 'investor', 'auditor', 'manager', 'operations_manager', 'plant_manager', 'finance_lead', 'accountant', 'inventory_officer'];
const manageRoles = ['admin', 'manager', 'operations_manager', 'plant_manager', 'finance_lead', 'inventory_officer'];

const cleanTruckPayload = (body = {}) => ({
  truckCode: body.truckCode,
  name: body.name,
  plateNumber: body.plateNumber,
  capacityKg: toNum(body.capacityKg),
  ownershipType: body.ownershipType,
  acquisitionCost: toNum(body.acquisitionCost),
  loanAmount: toNum(body.loanAmount),
  monthlyRepayment: toNum(body.monthlyRepayment),
  interestRatePct: toNum(body.interestRatePct),
  loanTenorMonths: toNum(body.loanTenorMonths),
  usefulLifeYears: toNum(body.usefulLifeYears, 5),
  insuranceAnnualCost: toNum(body.insuranceAnnualCost),
  licensingAnnualCost: toNum(body.licensingAnnualCost),
  maintenanceReserveMonthly: toNum(body.maintenanceReserveMonthly),
  expectedMonthlyTrips: toNum(body.expectedMonthlyTrips),
  expectedMonthlyKg: toNum(body.expectedMonthlyKg),
  targetGrossMarginPerKg: toNum(body.targetGrossMarginPerKg),
  defaultDriverId: body.defaultDriverId,
  defaultDriverName: body.defaultDriverName,
  defaultAssistantName: body.defaultAssistantName,
  homeBranchId: body.homeBranchId,
  homeBranchName: body.homeBranchName,
  status: body.status,
  notes: body.notes,
});

const cleanTripPayload = (body = {}) => ({
  tripCode: body.tripCode,
  truckId: body.truckId,
  truckName: body.truckName,
  plateNumber: body.plateNumber,
  capacityKg: toNum(body.capacityKg),
  ownershipType: body.ownershipType,
  monthlyRepayment: toNum(body.monthlyRepayment),
  monthlyDepreciation: toNum(body.monthlyDepreciation),
  fixedCostAllocation: toNum(body.fixedCostAllocation),
  tripType: body.tripType,
  sourceType: body.sourceType,
  sourceName: body.sourceName,
  plannedDepartureAt: asDate(body.plannedDepartureAt),
  loadingStartedAt: asDate(body.loadingStartedAt),
  loadedAt: asDate(body.loadedAt),
  departedAt: asDate(body.departedAt),
  completedAt: asDate(body.completedAt),
  closedAt: asDate(body.closedAt),
  status: body.status,
  expectedKg: toNum(body.expectedKg),
  loadedKg: toNum(body.loadedKg),
  purchasePricePerKg: toNum(body.purchasePricePerKg),
  purchaseCost: toNum(body.purchaseCost),
  loadingTicketNumber: body.loadingTicketNumber,
  waybillNumber: body.waybillNumber,
  supplierInvoiceNumber: body.supplierInvoiceNumber,
  driverId: body.driverId,
  driverName: body.driverName,
  assistantName: body.assistantName,
  startingOdometerKm: toNum(body.startingOdometerKm),
  endingOdometerKm: toNum(body.endingOdometerKm),
  kmTravelled: toNum(body.kmTravelled),
  notes: body.notes,
});

const cleanCostPayload = (body = {}) => ({
  category: body.category || 'MISCELLANEOUS',
  description: body.description,
  amount: toNum(body.amount),
  treatment: body.treatment || 'CAPITALISE',
  capitalisedRatioPct: body.treatment === 'SPLIT' ? toNum(body.capitalisedRatioPct, 50) : body.treatment === 'EXPENSE' ? 0 : 100,
  paidBy: body.paidBy,
  paymentMethod: body.paymentMethod,
  incurredAt: asDate(body.incurredAt) || now(),
  notes: body.notes,
});

const cleanOffloadPayload = (body = {}) => ({
  destinationType: body.destinationType || 'BRANCH',
  destinationId: body.destinationId || body.branchId || body.corporateClientId,
  destinationName: body.destinationName || body.branchName || body.corporateClientName,
  branchId: body.branchId,
  branchName: body.branchName,
  corporateClientId: body.corporateClientId,
  corporateClientName: body.corporateClientName,
  fulfilmentId: body.fulfilmentId,
  requestedKg: toNum(body.requestedKg),
  deliveredKg: toNum(body.deliveredKg || body.receivedKg || body.requestedKg),
  receivedKg: toNum(body.receivedKg || body.deliveredKg || body.requestedKg),
  sellingPricePerKg: toNum(body.sellingPricePerKg),
  deliveryCost: toNum(body.deliveryCost),
  deliveryAddress: body.deliveryAddress,
  offloadedAt: asDate(body.offloadedAt) || now(),
  receiptStatus: body.receiptStatus || 'PENDING',
  customerConfirmed: Boolean(body.customerConfirmed),
  confirmedBy: body.confirmedBy,
  confirmedAt: asDate(body.confirmedAt),
  stockInReference: body.stockInReference,
  waybillReference: body.waybillReference,
  notes: body.notes,
});

const stripUndefined = (payload) => {
  Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key]);
  return payload;
};

const attachTruckSnapshot = async (payload) => {
  if (!payload.truckId) return payload;
  const truck = await TruckAsset.findOne({ id: payload.truckId }).lean({ virtuals: true });
  if (!truck) throw new HttpError(404, 'Truck asset not found.');
  payload.truckName = payload.truckName || truck.name;
  payload.plateNumber = payload.plateNumber || truck.plateNumber;
  payload.capacityKg = payload.capacityKg || truck.capacityKg;
  payload.ownershipType = payload.ownershipType || truck.ownershipType;
  payload.monthlyRepayment = payload.monthlyRepayment || truck.monthlyRepayment || 0;
  payload.monthlyDepreciation = payload.monthlyDepreciation || truck.monthlyDepreciation || 0;
  payload.fixedCostAllocation = payload.fixedCostAllocation || (truck.fixedMonthlyCost && truck.expectedMonthlyTrips ? truck.fixedMonthlyCost / Math.max(truck.expectedMonthlyTrips, 1) : 0);
  payload.driverId = payload.driverId || truck.defaultDriverId;
  payload.driverName = payload.driverName || truck.defaultDriverName;
  payload.assistantName = payload.assistantName || truck.defaultAssistantName;
  return payload;
};

const setTruckStatusFromTrip = async (trip) => {
  if (!trip?.truckId) return;
  const statusMap = {
    PLANNED: 'IDLE',
    LOADING: 'IN_TRANSIT',
    LOADED: 'IN_TRANSIT',
    IN_TRANSIT: 'IN_TRANSIT',
    PARTIALLY_OFFLOADED: 'IN_TRANSIT',
    COMPLETED: 'IDLE',
    CLOSED: 'IDLE',
    UNDER_REVIEW: 'IDLE',
    CANCELLED: 'IDLE',
  };
  await TruckAsset.updateOne(
    { id: trip.truckId },
    { $set: { status: statusMap[trip.status] || 'ACTIVE', currentTripId: ['COMPLETED', 'CLOSED', 'CANCELLED'].includes(trip.status) ? null : trip.id } }
  );
};

const listTrucks = async (req, res, next) => {
  try {
    const { search = '', status = '', ownershipType = '', limit = 200 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (ownershipType) filter.ownershipType = ownershipType;
    if (search) {
      const rx = new RegExp(escapeRegex(search), 'i');
      filter.$or = [{ name: rx }, { plateNumber: rx }, { truckCode: rx }, { defaultDriverName: rx }];
    }
    const rows = await TruckAsset.find(filter).sort({ updatedAt: -1 }).limit(Math.min(Number(limit) || 200, 500)).lean({ virtuals: true });
    res.status(200).json({ rows });
  } catch (error) {
    logger.error('Fleet list trucks error:', error);
    next(new HttpError(500, 'Failed to load truck assets.'));
  }
};

const createTruck = async (req, res, next) => {
  try {
    const payload = stripUndefined(cleanTruckPayload(req.body));
    if (!payload.name) return next(new HttpError(400, 'Truck name is required.'));
    payload.createdBy = req.user?.id;
    payload.updatedBy = req.user?.id;
    const truck = await TruckAsset.create(payload);
    res.status(201).json({ message: 'Truck asset created successfully.', truck });
  } catch (error) {
    logger.error('Fleet create truck error:', error);
    next(new HttpError(500, error.message || 'Failed to create truck asset.'));
  }
};

const updateTruck = async (req, res, next) => {
  try {
    const payload = stripUndefined(cleanTruckPayload(req.body));
    payload.updatedBy = req.user?.id;
    const truck = await TruckAsset.findOneAndUpdate({ id: req.params.truckId }, { $set: payload }, { new: true, runValidators: true });
    if (!truck) return next(new HttpError(404, 'Truck asset not found.'));
    res.status(200).json({ message: 'Truck asset updated successfully.', truck });
  } catch (error) {
    logger.error('Fleet update truck error:', error);
    next(new HttpError(500, error.message || 'Failed to update truck asset.'));
  }
};

const listTrips = async (req, res, next) => {
  try {
    const { search = '', truckId = '', status = '', destinationType = '', limit = 200 } = req.query;
    const filter = {};
    if (truckId) filter.truckId = truckId;
    if (status) filter.status = status;
    if (destinationType) filter['offloads.destinationType'] = destinationType;
    if (search) {
      const rx = new RegExp(escapeRegex(search), 'i');
      filter.$or = [{ tripCode: rx }, { truckName: rx }, { plateNumber: rx }, { sourceName: rx }, { waybillNumber: rx }];
    }
    const rows = await TruckTrip.find(filter).sort({ plannedDepartureAt: -1, createdAt: -1 }).limit(Math.min(Number(limit) || 200, 500)).lean();
    res.status(200).json({ rows });
  } catch (error) {
    logger.error('Fleet list trips error:', error);
    next(new HttpError(500, 'Failed to load truck trips.'));
  }
};

const getTrip = async (req, res, next) => {
  try {
    const trip = await TruckTrip.findOne({ id: req.params.tripId }).lean();
    if (!trip) return next(new HttpError(404, 'Truck trip not found.'));
    res.status(200).json({ trip });
  } catch (error) {
    logger.error('Fleet get trip error:', error);
    next(new HttpError(500, 'Failed to load truck trip.'));
  }
};

const createTrip = async (req, res, next) => {
  try {
    let payload = stripUndefined(cleanTripPayload(req.body));
    if (!payload.truckId) return next(new HttpError(400, 'Truck is required.'));
    payload = await attachTruckSnapshot(payload);
    payload.createdBy = req.user?.id;
    payload.updatedBy = req.user?.id;
    const trip = await TruckTrip.create(payload);
    await setTruckStatusFromTrip(trip);
    res.status(201).json({ message: 'Truck trip created successfully.', trip });
  } catch (error) {
    logger.error('Fleet create trip error:', error);
    next(error instanceof HttpError ? error : new HttpError(500, error.message || 'Failed to create truck trip.'));
  }
};

const updateTrip = async (req, res, next) => {
  try {
    const payload = stripUndefined(cleanTripPayload(req.body));
    payload.updatedBy = req.user?.id;
    const trip = await TruckTrip.findOne({ id: req.params.tripId });
    if (!trip) return next(new HttpError(404, 'Truck trip not found.'));
    Object.assign(trip, payload);
    await trip.save();
    await setTruckStatusFromTrip(trip);
    res.status(200).json({ message: 'Truck trip updated successfully.', trip });
  } catch (error) {
    logger.error('Fleet update trip error:', error);
    next(new HttpError(500, error.message || 'Failed to update truck trip.'));
  }
};

const updateTripStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!status) return next(new HttpError(400, 'Status is required.'));
    const trip = await TruckTrip.findOne({ id: req.params.tripId });
    if (!trip) return next(new HttpError(404, 'Truck trip not found.'));
    trip.status = status;
    if (status === 'LOADING' && !trip.loadingStartedAt) trip.loadingStartedAt = now();
    if (status === 'LOADED' && !trip.loadedAt) trip.loadedAt = now();
    if (status === 'IN_TRANSIT' && !trip.departedAt) trip.departedAt = now();
    if (status === 'COMPLETED' && !trip.completedAt) trip.completedAt = now();
    if (status === 'CLOSED' && !trip.closedAt) trip.closedAt = now();
    if (req.body.notes) trip.notes = [trip.notes, req.body.notes].filter(Boolean).join('\n');
    trip.updatedBy = req.user?.id;
    await trip.save();
    await setTruckStatusFromTrip(trip);
    res.status(200).json({ message: 'Truck trip status updated successfully.', trip });
  } catch (error) {
    logger.error('Fleet update trip status error:', error);
    next(new HttpError(500, error.message || 'Failed to update truck trip status.'));
  }
};

const addTripCost = async (req, res, next) => {
  try {
    const trip = await TruckTrip.findOne({ id: req.params.tripId });
    if (!trip) return next(new HttpError(404, 'Truck trip not found.'));
    const cost = cleanCostPayload(req.body);
    if (cost.amount <= 0) return next(new HttpError(400, 'Cost amount must be greater than zero.'));
    trip.costs.unshift(cost);
    trip.updatedBy = req.user?.id;
    await trip.save();
    res.status(201).json({ message: 'Trip cost added successfully.', trip, cost: trip.costs[0] });
  } catch (error) {
    logger.error('Fleet add trip cost error:', error);
    next(new HttpError(500, error.message || 'Failed to add trip cost.'));
  }
};

const addOffload = async (req, res, next) => {
  try {
    const trip = await TruckTrip.findOne({ id: req.params.tripId });
    if (!trip) return next(new HttpError(404, 'Truck trip not found.'));
    const offload = cleanOffloadPayload(req.body);
    if (offload.deliveredKg <= 0) return next(new HttpError(400, 'Delivered KG must be greater than zero.'));
    trip.offloads.unshift(offload);
    if (trip.status === 'IN_TRANSIT' || trip.status === 'LOADED') trip.status = 'PARTIALLY_OFFLOADED';
    trip.updatedBy = req.user?.id;
    await trip.save();

    if (offload.fulfilmentId) {
      const fulfilmentPatch = {
        truckTripId: trip.id,
        truckId: trip.truckId,
        truckName: trip.truckName,
        vehicleType: 'TRUCK',
        deliveredKg: offload.deliveredKg,
        costPerKg: trip.economics?.landedCostPerKg || 0,
        deliveryCost: offload.deliveryCost || 0,
        customerConfirmed: offload.customerConfirmed,
        updatedBy: req.user?.id,
      };
      if (offload.sellingPricePerKg) fulfilmentPatch.sellingPricePerKg = offload.sellingPricePerKg;
      if (offload.receiptStatus === 'CONFIRMED') {
        fulfilmentPatch.status = 'DELIVERED';
        fulfilmentPatch.actualDeliveredAt = offload.offloadedAt;
      }
      await CorporateFulfilment.updateOne({ id: offload.fulfilmentId }, { $set: fulfilmentPatch })
        .catch((err) => logger.warn('Fleet offload fulfilment reference update skipped:', err.message));
    }

    res.status(201).json({ message: 'Trip offload added successfully.', trip, offload: trip.offloads[0] });
  } catch (error) {
    logger.error('Fleet add offload error:', error);
    next(new HttpError(500, error.message || 'Failed to add trip offload.'));
  }
};

const recalculateTrip = async (req, res, next) => {
  try {
    const trip = await TruckTrip.findOne({ id: req.params.tripId });
    if (!trip) return next(new HttpError(404, 'Truck trip not found.'));
    trip.recalculateEconomics();
    trip.updatedBy = req.user?.id;
    await trip.save();
    res.status(200).json({ message: 'Trip economics recalculated successfully.', trip });
  } catch (error) {
    logger.error('Fleet recalculate trip error:', error);
    next(new HttpError(500, 'Failed to recalculate trip economics.'));
  }
};

const groupSum = (rows, keyFn, valueFns = {}) => {
  const map = new Map();
  rows.forEach((row) => {
    const key = keyFn(row) || 'Unassigned';
    const cur = map.get(key) || { label: key, count: 0 };
    cur.count += 1;
    Object.entries(valueFns).forEach(([name, fn]) => { cur[name] = round(toNum(cur[name]) + toNum(fn(row))); });
    map.set(key, cur);
  });
  return Array.from(map.values()).sort((a, b) => toNum(b.netContributionAfterFixedCost || b.externalRevenue || b.deliveredKg || b.count) - toNum(a.netContributionAfterFixedCost || a.externalRevenue || a.deliveredKg || a.count));
};

const buildMobileInventory = (trips) => {
  return trips.map((trip) => {
    const e = trip.economics || {};
    const ledger = [
      {
        type: 'LOADED_TO_TRUCK',
        date: trip.loadedAt || trip.createdAt,
        description: `${trip.truckName || 'Truck'} loaded from ${trip.sourceName || 'supplier'}`,
        inKg: toNum(trip.loadedKg),
        outKg: 0,
        balanceKg: toNum(trip.loadedKg),
        costPerKg: toNum(trip.purchasePricePerKg),
      },
      ...arr(trip.offloads).map((o) => ({
        type: o.destinationType === 'BRANCH' ? 'BRANCH_OFFLOAD' : 'EXTERNAL_DELIVERY',
        date: o.offloadedAt,
        description: `${o.destinationName || o.branchName || o.corporateClientName || o.destinationType}`,
        inKg: 0,
        outKg: toNum(o.deliveredKg || o.receivedKg),
        balanceKg: null,
        costPerKg: toNum(e.landedCostPerKg),
        receiptStatus: o.receiptStatus,
        stockInReference: o.stockInReference,
        fulfilmentId: o.fulfilmentId,
      })),
    ];
    let balance = 0;
    ledger.forEach((line) => {
      balance += toNum(line.inKg) - toNum(line.outKg);
      line.balanceKg = round(balance);
    });
    return {
      tripId: trip.id,
      tripCode: trip.tripCode,
      truckName: trip.truckName,
      status: trip.status,
      loadedKg: toNum(trip.loadedKg),
      deliveredKg: toNum(e.deliveredKg),
      expectedBalanceKg: toNum(e.expectedBalanceKg),
      varianceKg: toNum(e.varianceKg),
      landedCostPerKg: toNum(e.landedCostPerKg),
      ledger,
    };
  });
};

const getDashboard = async (req, res, next) => {
  try {
    const [trucks, trips] = await Promise.all([
      TruckAsset.find({}).sort({ updatedAt: -1 }).lean({ virtuals: true }),
      TruckTrip.find({}).sort({ plannedDepartureAt: -1, createdAt: -1 }).limit(500).lean(),
    ]);
    const activeTrips = trips.filter((t) => ['PLANNED', 'LOADING', 'LOADED', 'IN_TRANSIT', 'PARTIALLY_OFFLOADED', 'UNDER_REVIEW'].includes(t.status));
    const completedTrips = trips.filter((t) => ['COMPLETED', 'CLOSED'].includes(t.status));
    const sumE = (name) => trips.reduce((sum, t) => sum + toNum(t.economics?.[name]), 0);
    const deliveredKg = sumE('deliveredKg');
    const externalRevenue = sumE('externalRevenue');
    const directTruckProfit = sumE('directTruckProfit');
    const netContributionAfterFixedCost = sumE('netContributionAfterFixedCost');

    const byTruck = groupSum(trips, (t) => t.truckName || t.truckId, {
      loadedKg: (t) => t.economics?.loadedKg,
      deliveredKg: (t) => t.economics?.deliveredKg,
      externalRevenue: (t) => t.economics?.externalRevenue,
      directTruckProfit: (t) => t.economics?.directTruckProfit,
      netContributionAfterFixedCost: (t) => t.economics?.netContributionAfterFixedCost,
      varianceKg: (t) => t.economics?.varianceKg,
    });
    const byDestination = groupSum(trips.flatMap((t) => arr(t.offloads).map((o) => ({ ...o, landedCostPerKg: t.economics?.landedCostPerKg }))), (o) => o.destinationName || o.branchName || o.corporateClientName || o.destinationType, {
      deliveredKg: (o) => o.deliveredKg || o.receivedKg,
      transferValue: (o) => toNum(o.deliveredKg || o.receivedKg) * toNum(o.landedCostPerKg),
      revenue: (o) => toNum(o.deliveredKg || o.receivedKg) * toNum(o.sellingPricePerKg),
    });

    res.status(200).json({
      metrics: {
        truckCount: trucks.length,
        activeTruckCount: trucks.filter((t) => ['ACTIVE', 'IN_TRANSIT', 'IDLE'].includes(t.status)).length,
        activeTrips: activeTrips.length,
        completedTrips: completedTrips.length,
        loadedKg: round(sumE('loadedKg')),
        deliveredKg: round(deliveredKg),
        internalDeliveredKg: round(sumE('internalDeliveredKg')),
        externalDeliveredKg: round(sumE('externalDeliveredKg')),
        varianceKg: round(sumE('varianceKg')),
        totalPurchaseCost: round(sumE('purchaseCost')),
        totalTripCost: round(sumE('totalTripCost')),
        landedCostPerKg: deliveredKg > 0 ? round(sumE('landedCostBasis') / deliveredKg) : 0,
        externalRevenue: round(externalRevenue),
        externalGrossProfit: round(sumE('externalGrossProfit')),
        directTruckProfit: round(directTruckProfit),
        internalTransferValue: round(sumE('internalTransferValue')),
        netContributionAfterFixedCost: round(netContributionAfterFixedCost),
        avgCostPerKgTransported: deliveredKg > 0 ? round(sumE('totalTripCost') / deliveredKg) : 0,
      },
      trucks: trucks.slice(0, 20),
      activeTrips: activeTrips.slice(0, 20),
      recentTrips: trips.slice(0, 30),
      byTruck: byTruck.slice(0, 20),
      byDestination: byDestination.slice(0, 20),
      mobileInventory: buildMobileInventory(activeTrips.slice(0, 20)),
    });
  } catch (error) {
    logger.error('Fleet dashboard error:', error);
    next(new HttpError(500, 'Failed to load fleet economics dashboard.'));
  }
};

const getMobileInventory = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.truckId) filter.truckId = req.query.truckId;
    if (req.query.tripId) filter.id = req.query.tripId;
    if (!req.query.includeClosed) filter.status = { $nin: ['CLOSED', 'CANCELLED'] };
    const trips = await TruckTrip.find(filter).sort({ plannedDepartureAt: -1, createdAt: -1 }).limit(100).lean();
    res.status(200).json({ rows: buildMobileInventory(trips) });
  } catch (error) {
    logger.error('Fleet mobile inventory error:', error);
    next(new HttpError(500, 'Failed to load mobile inventory ledger.'));
  }
};

module.exports = {
  readRoles,
  manageRoles,
  getDashboard,
  getMobileInventory,
  listTrucks,
  createTruck,
  updateTruck,
  listTrips,
  getTrip,
  createTrip,
  updateTrip,
  updateTripStatus,
  addTripCost,
  addOffload,
  recalculateTrip,
};
