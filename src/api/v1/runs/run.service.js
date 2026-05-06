// File: src/api/v1/runs/run.service.js
const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');
const Run = require('../../../models/run.model');
const Order = require('../../../models/order.model');
const User = require('../../../models/user.model');
const Van = require('../../../models/van.model');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config.js');

// Unified push notifications (FCM wrapper with token lookup)
const { notifyMessage } = require('../fcm/fcm.service');

// =============================================================================
//  WAVE 11B/12: DISPATCH, RUNS, ROUTE OPTIMIZATION & DRIVER OPERATIONS HELPERS
// =============================================================================

const TERMINAL_STOP_STATUSES = ['DELIVERED', 'CUSTOMER_UNAVAILABLE', 'ISSUE_REPORTED', 'CANCELED'];
const ACTIVE_RUN_STATUSES = ['Assigned', 'In Progress'];
const OPEN_RUN_STATUSES = ['Pending', 'Assigned', 'In Progress', 'Partially Completed'];

const toNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const round2 = (value) => Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;

const hasValidCoordinate = (lat, lng) => (
  Number.isFinite(Number(lat)) &&
  Number.isFinite(Number(lng)) &&
  Number(lat) >= -90 &&
  Number(lat) <= 90 &&
  Number(lng) >= -180 &&
  Number(lng) <= 180 &&
  !(Number(lat) === 0 && Number(lng) === 0)
);

/**
 * Correct coordinate extraction.
 * The previous implementation sometimes read order.longitude, which is not part of the Order schema.
 * Source priority:
 * 1. order.deliveryLatitude / order.deliveryLongitude
 * 2. order.deliveryAddressSnapshot.latitude / order.deliveryAddressSnapshot.longitude
 */
const getOrderCoordinates = (order) => {
  const deliveryLat = toNumber(order?.deliveryLatitude, NaN);
  const deliveryLng = toNumber(order?.deliveryLongitude, NaN);
  if (hasValidCoordinate(deliveryLat, deliveryLng)) {
    return { latitude: deliveryLat, longitude: deliveryLng, source: 'delivery_fields' };
  }

  const snapLat = toNumber(order?.deliveryAddressSnapshot?.latitude, NaN);
  const snapLng = toNumber(order?.deliveryAddressSnapshot?.longitude, NaN);
  if (hasValidCoordinate(snapLat, snapLng)) {
    return { latitude: snapLat, longitude: snapLng, source: 'address_snapshot' };
  }

  return { latitude: undefined, longitude: undefined, source: 'missing' };
};

const getDriverStartPoint = (driver, fallbackStop) => {
  const coords = driver?.currentLocation?.coordinates;
  if (
    Array.isArray(coords) &&
    coords.length >= 2 &&
    hasValidCoordinate(coords[1], coords[0])
  ) {
    return {
      latitude: Number(coords[1]),
      longitude: Number(coords[0]),
      source: 'driver_current_location',
    };
  }

  if (fallbackStop && hasValidCoordinate(fallbackStop.latitude, fallbackStop.longitude)) {
    return {
      latitude: Number(fallbackStop.latitude),
      longitude: Number(fallbackStop.longitude),
      source: 'first_stop_fallback',
    };
  }

  return {
    latitude: 6.5244,
    longitude: 3.3792,
    source: 'lagos_default_fallback',
  };
};

const deg2rad = (deg) => deg * (Math.PI / 180);

const getDistanceKm = (lat1, lon1, lat2, lon2) => {
  if (!hasValidCoordinate(lat1, lon1) || !hasValidCoordinate(lat2, lon2)) return 0;

  const R = 6371;
  const dLat = deg2rad(Number(lat2) - Number(lat1));
  const dLon = deg2rad(Number(lon2) - Number(lon1));
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(Number(lat1))) *
      Math.cos(deg2rad(Number(lat2))) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

/**
 * Nearest-neighbour route sequencing.
 * Valid-coordinate stops are sequenced first. Missing-coordinate stops are retained at the end.
 */
const optimizeStopsSequence = (startLat, startLng, stops = []) => {
  const validStops = [];
  const invalidStops = [];

  for (const stop of stops || []) {
    const clean = typeof stop.toObject === 'function' ? stop.toObject() : { ...stop };
    if (hasValidCoordinate(clean.latitude, clean.longitude)) validStops.push(clean);
    else invalidStops.push(clean);
  }

  const pending = [...validStops];
  const optimized = [];
  let currentLat = Number(startLat);
  let currentLng = Number(startLng);
  let totalDistanceKm = 0;

  while (pending.length > 0) {
    let nearestIndex = 0;
    let nearestDistance = Infinity;

    pending.forEach((stop, index) => {
      const distance = getDistanceKm(currentLat, currentLng, stop.latitude, stop.longitude);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });

    const nextStop = pending.splice(nearestIndex, 1)[0];
    totalDistanceKm += Number.isFinite(nearestDistance) ? nearestDistance : 0;
    optimized.push(nextStop);
    currentLat = Number(nextStop.latitude);
    currentLng = Number(nextStop.longitude);
  }

  return {
    stops: [...optimized, ...invalidStops].map((stop, index) => ({
      ...stop,
      sequence: index + 1,
    })),
    totalDistanceKm: round2(totalDistanceKm),
    validStopCount: validStops.length,
    missingCoordinateStopCount: invalidStops.length,
  };
};

const extractKgFromText = (value) => {
  const raw = String(value || '').toLowerCase().replace(',', '.');
  const match = raw.match(/(\d+(?:\.\d+)?)\s*kg/);
  return match ? Number(match[1]) : 0;
};

const estimateOrderLoadKg = (order) => {
  const items = Array.isArray(order?.items) ? order.items : [];
  return round2(
    items.reduce((sum, item) => {
      const kg =
        toNumber(item.kg, 0) ||
        toNumber(item.weightKg, 0) ||
        toNumber(item.sizeKg, 0) ||
        extractKgFromText(item.cylinderId) ||
        extractKgFromText(item.productName);

      const qty = Math.max(1, toNumber(item.quantity, 1));
      return sum + kg * qty;
    }, 0)
  );
};

const estimateRunLoadKgFromOrders = (orders = []) => round2(orders.reduce((sum, order) => sum + estimateOrderLoadKg(order), 0));

const deriveCapacityStatus = (estimatedLoadKg, capacityKg) => {
  const load = toNumber(estimatedLoadKg, 0);
  const capacity = toNumber(capacityKg, 0);

  if (capacity <= 0) {
    return {
      capacityStatus: 'NOT_CONFIGURED',
      capacityUtilizationPct: 0,
      capacityVarianceKg: 0,
      overCapacity: false,
    };
  }

  const utilization = (load / capacity) * 100;
  const variance = capacity - load;

  return {
    capacityStatus: load > capacity ? 'OVER_CAPACITY' : utilization >= 90 ? 'NEAR_CAPACITY' : 'OK',
    capacityUtilizationPct: round2(utilization),
    capacityVarianceKg: round2(variance),
    overCapacity: load > capacity,
  };
};

const buildStopFromOrder = (order, sequence) => {
  const coords = getOrderCoordinates(order);
  return {
    stopId: uuidv4(),
    orderId: order.id,
    sequence,
    status: 'Pending',
    latitude: coords.latitude,
    longitude: coords.longitude,
    coordinateSource: coords.source,
    estimatedLoadKg: estimateOrderLoadKg(order),
    statusHistory: [],
  };
};

const mapDriverStopStatusToOrderStatus = (driverStopStatus) => {
  const mapping = {
    DRIVER_ENROUTE_PICKUP: 'Processing',
    PICKED_UP_ENROUTE_STATION: 'Processing',
    CYLINDER_REFILLING: 'Processing',
    OUT_FOR_DELIVERY: 'Out for Delivery',
    DELIVERED: 'Delivered',
    CUSTOMER_UNAVAILABLE: 'Customer Unavailable',
    ISSUE_REPORTED: 'Failed',
    CANCELED: 'Canceled',
  };
  return mapping[driverStopStatus] || null;
};

const maybeNotifyOrderStatus = async (order, mappedStatus, driverId) => {
  try {
    await notifyMessage({
      recipientId: order.customerId,
      title: 'Order Update',
      body: `Your order status is now: ${mappedStatus}`,
      data: {
        type: 'ORDER_UPDATE',
        orderId: order.id,
        screen: 'order_details',
      },
    });
  } catch (err) {
    logger.error?.('[RUN_SERVICE] Customer notification failed:', {
      orderId: order?.id,
      driverId,
      message: err?.message,
    });
  }
};

// =============================================================================
//  CORE RUN QUERIES
// =============================================================================

const getPendingBatches = async () => {
  try {
    const pendingRuns = await Run.find({ overallStatus: 'Pending' }).sort({ createdAt: -1 });
    return pendingRuns.map((run) => run.toObject());
  } catch (error) {
    logger.error('[RUN_SERVICE] Error fetching pending batches:', error);
    throw new HttpError(500, 'Failed to retrieve pending batches.');
  }
};

const getActiveRuns = async () => {
  try {
    const activeRuns = await Run.find({
      overallStatus: { $in: ACTIVE_RUN_STATUSES },
    })
      .populate('driver')
      .sort({ updatedAt: -1 });

    return activeRuns.map((run) => run.toObject());
  } catch (error) {
    logger.error('[RUN_SERVICE] Unexpected error in getActiveRuns:', error);
    throw new HttpError(500, 'Failed to retrieve active runs.');
  }
};

const getUnassignedOrders = async (options = {}) => {
  const { page = 1, limit = 50, zoneId } = options;

  try {
    const query = {
      $or: [{ driverId: null }, { driverId: { $exists: false } }, { driverId: '' }],
      status: { $in: ['Order Placed', 'Pending Pickup', 'Ready for Delivery', 'Awaiting Driver Arrival'] },
    };

    if (zoneId) query.serviceZoneId = zoneId;

    const safePage = Math.max(1, parseInt(page, 10) || 1);
    const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));

    const [totalOrders, orders] = await Promise.all([
      Order.countDocuments(query),
      Order.find(query)
        .sort({ orderDate: 1, createdAt: 1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit),
    ]);

    return {
      orders: orders.map((order) => order.toObject()),
      currentPage: safePage,
      totalPages: Math.ceil(totalOrders / safeLimit),
      totalOrders,
    };
  } catch (error) {
    logger.error('[RUN_SERVICE] Error fetching unassigned orders:', error);
    throw new HttpError(500, 'Failed to retrieve unassigned orders.');
  }
};

const getRun = async (runId, requestingUser = {}) => {
  try {
    const run = await Run.findOne({ id: runId })
      .populate({
        path: 'driver',
        select: 'id name phone email currentLocation driverProfile latitude longitude',
      })
      .populate({
        path: 'stops.order',
        model: 'Order',
        populate: {
          path: 'customer',
          model: 'User',
          select: 'id name phone email',
        },
      });

    if (!run) throw new HttpError(404, 'Run not found.');

    if (requestingUser.role === 'driver' && run.driverId !== requestingUser.id) {
      throw new HttpError(403, 'You are not authorized to access this run.');
    }

    return run.toObject();
  } catch (error) {
    logger.error(`[RUN_SERVICE] Unexpected error in getRun for runId ${runId}:`, error);
    if (error instanceof HttpError) throw error;
    throw new HttpError(500, 'Failed to retrieve run details.');
  }
};

// =============================================================================
//  RUN CREATION, DRIVER ASSIGNMENT, OPTIMIZATION & CAPACITY
// =============================================================================

const createRunFromBatch = async (orderIds, adminId) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const cleanOrderIds = [...new Set((orderIds || []).filter(Boolean).map(String))];
    if (!cleanOrderIds.length) throw new HttpError(400, 'At least one orderId is required.');

    const ordersToBatch = await Order.find({
      id: { $in: cleanOrderIds },
      status: { $in: ['Order Placed', 'Awaiting Driver Arrival', 'Pending Pickup', 'Ready for Delivery'] },
    }).session(session);

    if (ordersToBatch.length !== cleanOrderIds.length) {
      throw new HttpError(400, 'One or more orders are not available for batching or do not exist.');
    }

    const alreadyAssigned = ordersToBatch.find((order) => order.driverId || order.runId);
    if (alreadyAssigned) {
      throw new HttpError(400, `Order ${alreadyAssigned.id} is already assigned to a driver or run.`);
    }

    const orderMap = new Map(ordersToBatch.map((order) => [order.id, order]));
    const ordered = cleanOrderIds.map((id) => orderMap.get(id)).filter(Boolean);
    const stops = ordered.map((order, index) => buildStopFromOrder(order, index + 1));
    const estimatedLoadKg = estimateRunLoadKgFromOrders(ordered);
    const primaryZone = ordered[0]?.serviceZoneId || ordered[0]?.zoneId || ordered[0]?.branchId || 'Unknown Zone';

    const newRun = new Run({
      id: uuidv4(),
      overallStatus: 'Pending',
      stops,
      totalStops: stops.length,
      completedStops: 0,
      estimatedLoadKg,
      capacityKg: 0,
      capacityStatus: 'NOT_CONFIGURED',
      notes: `Batch for Zone/Branch: ${primaryZone}. Created by admin ${adminId}.`,
      statusHistory: [{
        status: 'Pending',
        timestamp: new Date(),
        notes: `Run batch created with ${stops.length} stop(s).`,
        updatedBy: adminId,
        updaterRole: 'admin',
      }],
    });

    await newRun.save({ session });

    await Order.updateMany(
      { id: { $in: cleanOrderIds } },
      {
        $set: { status: 'Processing', runId: newRun.id },
        $push: {
          statusHistory: {
            status: 'Processing',
            timestamp: new Date(),
            notes: `Order grouped into run ${newRun.id}.`,
            updatedBy: adminId,
            updaterRole: 'admin',
          },
        },
      },
      { session }
    );

    await session.commitTransaction();
    logger.info(`[RUN_SERVICE] Run ${newRun.id} created with ${stops.length} stops.`);
    return newRun.toObject();
  } catch (error) {
    await session.abortTransaction();
    logger.error('[RUN_SERVICE] Error creating run from batch:', error);
    if (error instanceof HttpError) throw error;
    throw new HttpError(500, 'Failed to create run from batch.');
  } finally {
    session.endSession();
  }
};

const optimizeRunRoute = async (runId, options = {}) => {
  const run = await Run.findOne({ id: runId });
  if (!run) throw new HttpError(404, 'Run not found.');

  let startPoint = null;
  if (hasValidCoordinate(options.startLatitude, options.startLongitude)) {
    startPoint = {
      latitude: Number(options.startLatitude),
      longitude: Number(options.startLongitude),
      source: 'manual_start_point',
    };
  }

  if (!startPoint && run.driverId) {
    const driver = await User.findOne({ id: run.driverId, role: 'driver' }).lean();
    startPoint = getDriverStartPoint(driver, run.stops?.[0]);
  }

  if (!startPoint) {
    startPoint = getDriverStartPoint(null, run.stops?.[0]);
  }

  const optimized = optimizeStopsSequence(startPoint.latitude, startPoint.longitude, run.stops || []);
  run.stops = optimized.stops;
  run.routeOptimization = {
    optimized: true,
    optimizedAt: new Date(),
    algorithm: 'nearest_neighbor',
    startLatitude: startPoint.latitude,
    startLongitude: startPoint.longitude,
    startSource: startPoint.source,
    totalDistanceKm: optimized.totalDistanceKm,
    validStopCount: optimized.validStopCount,
    missingCoordinateStopCount: optimized.missingCoordinateStopCount,
  };

  await run.save();

  return run.toObject();
};

const assignDriverToRun = async (runId, newDriverId, adminPerformingActionId, options = {}) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const run = await Run.findOne({ id: runId }).session(session);
    if (!run) throw new HttpError(404, 'Run not found for assignment.');

    if (!['Pending', 'Assigned'].includes(run.overallStatus)) {
      throw new HttpError(400, `This run is already '${run.overallStatus}' and cannot be assigned.`);
    }

    const newDriver = await User.findOne({ id: newDriverId, role: 'driver' }).session(session);
    if (!newDriver) throw new HttpError(404, `Driver with ID ${newDriverId} not found or is not a driver.`);

    let van = null;
    if (options.vanId) {
      van = await Van.findOne({ id: options.vanId }).session(session);
      if (!van) throw new HttpError(404, `Van ${options.vanId} was not found.`);
    } else {
      van = await Van.findOne({ driverId: newDriverId }).session(session);
    }

    const capacityKg =
      toNumber(options.capacityKg, 0) ||
      toNumber(van?.capacityKg, 0) ||
      toNumber(van?.loadCapacityKg, 0) ||
      toNumber(van?.capacity, 0) ||
      toNumber(run.capacityKg, 0);

    const orderIds = (run.stops || []).map((s) => s.orderId).filter(Boolean);
    const orders = await Order.find({ id: { $in: orderIds } }).session(session);
    const estimatedLoadKg = estimateRunLoadKgFromOrders(orders);
    const capacity = deriveCapacityStatus(estimatedLoadKg, capacityKg);

    const startPoint = getDriverStartPoint(newDriver, run.stops?.[0]);
    const optimized = optimizeStopsSequence(startPoint.latitude, startPoint.longitude, run.stops || []);

    run.stops = optimized.stops;
    run.driverId = newDriverId;
    run.vanId = van?.id || options.vanId || run.vanId;
    run.overallStatus = 'Assigned';
    run.estimatedLoadKg = estimatedLoadKg;
    run.capacityKg = capacityKg;
    run.capacityStatus = capacity.capacityStatus;
    run.capacityUtilizationPct = capacity.capacityUtilizationPct;
    run.capacityVarianceKg = capacity.capacityVarianceKg;
    run.routeOptimization = {
      optimized: true,
      optimizedAt: new Date(),
      algorithm: 'nearest_neighbor',
      startLatitude: startPoint.latitude,
      startLongitude: startPoint.longitude,
      startSource: startPoint.source,
      totalDistanceKm: optimized.totalDistanceKm,
      validStopCount: optimized.validStopCount,
      missingCoordinateStopCount: optimized.missingCoordinateStopCount,
    };

    if (!Array.isArray(run.statusHistory)) run.statusHistory = [];
    run.statusHistory.push({
      status: 'Assigned',
      timestamp: new Date(),
      notes: `Assigned to driver ${newDriver.name || newDriver.email || newDriver.id}. Route optimized from ${startPoint.source}. Capacity status: ${capacity.capacityStatus}.`,
      updatedBy: adminPerformingActionId,
      updaterRole: 'admin',
    });

    for (const stop of run.stops || []) {
      const order = orders.find((o) => o.id === stop.orderId);
      if (order) {
        order.driverId = newDriverId;
        order.runId = run.id;
        order.driverAssignedAt = new Date();
        order.status = 'Driver Assigned';
        if (!Array.isArray(order.statusHistory)) order.statusHistory = [];
        order.statusHistory.push({
          status: 'Driver Assigned',
          timestamp: new Date(),
          notes: `Assigned to driver ${newDriver.name || newDriver.email || newDriver.id}. Sequence: ${stop.sequence}`,
          updatedBy: adminPerformingActionId,
          updaterRole: 'admin',
        });
        await order.save({ session });
      }
    }

    if (van) {
      van.status = 'On Delivery';
      van.currentRunId = run.id;
      await van.save({ session });
    }

    await run.save({ session });
    await session.commitTransaction();

    logger.info(`[RUN_SERVICE] Run ${run.id} assigned to driver ${newDriver.id}; route optimized.`);
    return run.toObject();
  } catch (error) {
    await session.abortTransaction();
    logger.error(`[RUN_SERVICE] Error assigning driver for run ${runId}:`, error);
    if (error instanceof HttpError) throw error;
    throw new HttpError(500, 'Failed to assign driver due to a server error.');
  } finally {
    session.endSession();
  }
};

const updateRunCapacity = async (runId, payload = {}, userId) => {
  const run = await Run.findOne({ id: runId });
  if (!run) throw new HttpError(404, 'Run not found.');

  const orderIds = (run.stops || []).map((s) => s.orderId).filter(Boolean);
  const orders = await Order.find({ id: { $in: orderIds } }).lean();
  const estimatedLoadKg = estimateRunLoadKgFromOrders(orders);

  const capacityKg = toNumber(payload.capacityKg, 0) || toNumber(run.capacityKg, 0);
  const capacity = deriveCapacityStatus(estimatedLoadKg, capacityKg);

  run.capacityKg = capacityKg;
  run.estimatedLoadKg = estimatedLoadKg;
  run.capacityStatus = capacity.capacityStatus;
  run.capacityUtilizationPct = capacity.capacityUtilizationPct;
  run.capacityVarianceKg = capacity.capacityVarianceKg;

  if (payload.vanId) run.vanId = String(payload.vanId);

  if (!Array.isArray(run.statusHistory)) run.statusHistory = [];
  run.statusHistory.push({
    status: run.overallStatus,
    timestamp: new Date(),
    notes: `Capacity reviewed. Load ${estimatedLoadKg}kg / Capacity ${capacityKg}kg. Status: ${capacity.capacityStatus}.`,
    updatedBy: userId,
    updaterRole: 'admin',
  });

  await run.save();
  return run.toObject();
};

// =============================================================================
//  DRIVER ACTIONS
// =============================================================================

const getAssignedRuns = async (driverId) => {
  try {
    const runs = await Run.find({
      driverId,
      overallStatus: { $in: ACTIVE_RUN_STATUSES },
    })
      .populate('driver')
      .sort({ createdAt: -1 });

    return runs.map((run) => run.toObject());
  } catch (error) {
    logger.error('[RUN_SERVICE] Unexpected error in getAssignedRuns:', error);
    throw new HttpError(500, 'Failed to retrieve assigned runs.');
  }
};

const driverAcceptRun = async (driverId, runId) => {
  const run = await Run.findOneAndUpdate(
    { id: runId, driverId, overallStatus: 'Assigned' },
    {
      $set: { overallStatus: 'In Progress', actualStartDate: new Date() },
      $push: {
        statusHistory: {
          status: 'In Progress',
          timestamp: new Date(),
          notes: 'Driver accepted the run.',
          updatedBy: driverId,
          updaterRole: 'driver',
        },
      },
    },
    { new: true }
  );

  if (!run) throw new HttpError(400, 'Run not found, not assigned to you, or already accepted.');

  const orderIds = (run.stops || []).map((s) => s.orderId).filter(Boolean);
  if (!orderIds.length) return { message: 'Run accepted. No orders to update.', run: run.toObject() };

  const orders = await Order.find({ id: { $in: orderIds } });

  for (const order of orders) {
    const oldStatus = order.status;
    order.status = 'Driver Assigned';
    if (!Array.isArray(order.statusHistory)) order.statusHistory = [];
    order.statusHistory.push({
      status: 'Driver Assigned',
      timestamp: new Date(),
      notes: 'Driver accepted delivery run.',
      updatedBy: driverId,
      updaterRole: 'driver',
    });
    await order.save();

    if (oldStatus !== 'Driver Assigned' && order.paymentMethod !== 'payOnPickup') {
      await maybeNotifyOrderStatus(order, 'Driver Assigned', driverId);
    }
  }

  return { message: 'Run accepted and order status updated successfully.', run: run.toObject() };
};

const acceptRun = (runId, driverId) => driverAcceptRun(driverId, runId);

const driverUpdateStopStatus = async (driverId, runId, stopId, newStatus, notes) => {
  const run = await Run.findOne({ id: runId, driverId });
  if (!run) throw new HttpError(404, 'Run not found or not assigned to this driver.');

  const stop = (run.stops || []).find((s) => s.stopId === stopId);
  if (!stop) throw new HttpError(404, 'Stop not found in this run.');

  const now = new Date();
  stop.status = newStatus;
  if (!Array.isArray(stop.statusHistory)) stop.statusHistory = [];
  stop.statusHistory.push({
    status: newStatus,
    timestamp: now,
    notes,
    updatedBy: driverId,
    updaterRole: 'driver',
  });

  if (newStatus === 'DELIVERED') {
    stop.actualArrivalTime = now;
  }

  if (['CUSTOMER_UNAVAILABLE', 'ISSUE_REPORTED', 'CANCELED'].includes(newStatus)) {
    stop.failedAt = now;
    stop.failedBy = driverId;
    stop.failureReason = stop.failureReason || newStatus;
    stop.failureNote = notes || stop.failureNote;
  }

  run.completedStops = (run.stops || []).filter((s) => TERMINAL_STOP_STATUSES.includes(s.status)).length;
  run.failedDeliveryCount = (run.stops || []).filter((s) => ['CUSTOMER_UNAVAILABLE', 'ISSUE_REPORTED', 'CANCELED'].includes(s.status)).length;

  const allTerminal = (run.stops || []).length > 0 && (run.stops || []).every((s) => TERMINAL_STOP_STATUSES.includes(s.status));
  if (allTerminal) {
    run.overallStatus = run.failedDeliveryCount > 0 ? 'Partially Completed' : 'Completed';
    run.actualCompletionDate = now;
    if (!Array.isArray(run.statusHistory)) run.statusHistory = [];
    run.statusHistory.push({
      status: run.overallStatus,
      timestamp: now,
      notes: 'All stops reached terminal state.',
      updatedBy: driverId,
      updaterRole: 'driver',
    });
  }

  await run.save();

  try {
    const mappedStatus = mapDriverStopStatusToOrderStatus(newStatus);
    if (mappedStatus) {
      const order = await Order.findOne({ id: stop.orderId });
      if (order) {
        const oldStatus = order.status;
        order.status = mappedStatus;
        if (mappedStatus === 'Delivered') {
          order.actualDeliveryTime = now;
          order.deliveredAt = now;
        }
        if (['Failed', 'Canceled', 'Customer Unavailable'].includes(mappedStatus)) {
          order.firstAttemptAt = order.firstAttemptAt || now;
        }
        if (!Array.isArray(order.statusHistory)) order.statusHistory = [];
        order.statusHistory.push({
          status: mappedStatus,
          timestamp: now,
          notes: notes || `Driver updated stop ${stopId} to ${newStatus}`,
          updatedBy: driverId,
          updaterRole: 'driver',
        });
        await order.save();

        if (oldStatus !== mappedStatus) {
          await maybeNotifyOrderStatus(order, mappedStatus, driverId);
        }
      }
    }
  } catch (err) {
    logger.error('[RUN_SERVICE] Order status mirror failed:', {
      message: err?.message,
      runId,
      stopId,
    });
  }

  const updatedRun = await Run.findOne({ id: runId }).lean();
  return updatedRun;
};

const recordFailedDeliveryReason = async (runId, stopId, payload = {}, user = {}) => {
  const run = await Run.findOne({ id: runId });
  if (!run) throw new HttpError(404, 'Run not found.');

  if (user.role === 'driver' && run.driverId !== user.id) {
    throw new HttpError(403, 'You are not authorized to update this run.');
  }

  const stop = (run.stops || []).find((s) => s.stopId === stopId);
  if (!stop) throw new HttpError(404, 'Stop not found in this run.');

  const reason = String(payload.reason || payload.failureReason || '').trim();
  if (!reason) throw new HttpError(400, 'Failure reason is required.');

  const now = new Date();
  stop.status = payload.status || 'CUSTOMER_UNAVAILABLE';
  stop.failureReason = reason;
  stop.failureNote = payload.note || payload.notes || '';
  stop.failedAt = now;
  stop.failedBy = user.id || 'system';

  if (!Array.isArray(stop.statusHistory)) stop.statusHistory = [];
  stop.statusHistory.push({
    status: stop.status,
    timestamp: now,
    notes: `${reason}${stop.failureNote ? ` - ${stop.failureNote}` : ''}`,
    updatedBy: user.id,
    updaterRole: user.role || 'admin',
  });

  run.completedStops = (run.stops || []).filter((s) => TERMINAL_STOP_STATUSES.includes(s.status)).length;
  run.failedDeliveryCount = (run.stops || []).filter((s) => ['CUSTOMER_UNAVAILABLE', 'ISSUE_REPORTED', 'CANCELED'].includes(s.status)).length;

  await run.save();

  const order = await Order.findOne({ id: stop.orderId });
  if (order) {
    order.status = stop.status === 'CANCELED' ? 'Canceled' : stop.status === 'ISSUE_REPORTED' ? 'Failed' : 'Customer Unavailable';
    if (!Array.isArray(order.statusHistory)) order.statusHistory = [];
    order.statusHistory.push({
      status: order.status,
      timestamp: now,
      notes: `${reason}${stop.failureNote ? ` - ${stop.failureNote}` : ''}`,
      updatedBy: user.id,
      updaterRole: user.role || 'admin',
    });
    await order.save();
  }

  return run.toObject();
};

const endRun = async (runId, driverId) => {
  const run = await Run.findOne({ id: runId, driverId });
  if (!run) throw new HttpError(404, 'Run not found or not assigned to you.');

  const totalStops = (run.stops || []).length;
  const terminalStops = (run.stops || []).filter((s) => TERMINAL_STOP_STATUSES.includes(s.status)).length;

  if (terminalStops < totalStops) {
    throw new HttpError(400, `Cannot end run. Only ${terminalStops} of ${totalStops} stops are completed or resolved.`);
  }

  if (run.overallStatus === 'Completed' || run.overallStatus === 'Partially Completed') {
    return { message: 'This run has already been completed.', run: run.toObject() };
  }

  run.overallStatus = run.failedDeliveryCount > 0 ? 'Partially Completed' : 'Completed';
  run.completedStops = terminalStops;
  run.actualCompletionDate = new Date();
  await run.save();

  logger.info(`[RUN_SERVICE] Run ${runId} ended by driver ${driverId}.`);
  return { message: 'Run successfully marked as completed.', run: run.toObject() };
};

const getRunHistory = async (driverId, options = {}) => {
  try {
    const { page = 1, limit = 15 } = options;
    const safePage = Math.max(1, parseInt(page, 10) || 1);
    const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 15));

    const query = {
      driverId,
      overallStatus: { $in: ['Completed', 'Partially Completed'] },
    };

    const [totalRuns, runs] = await Promise.all([
      Run.countDocuments(query),
      Run.find(query)
        .sort({ actualCompletionDate: -1, updatedAt: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .populate({
          path: 'stops.order',
          model: 'Order',
          select: 'recipientName deliveryAddressSnapshot feedback grandTotal status',
        }),
    ]);

    return {
      runs: runs.map((run) => run.toObject()),
      currentPage: safePage,
      totalPages: Math.ceil(totalRuns / safeLimit),
      totalRuns,
    };
  } catch (error) {
    logger.error(`[RUN_SERVICE] Error fetching run history for driver ${driverId}:`, error);
    throw new HttpError(500, 'Failed to retrieve delivery history.');
  }
};

// =============================================================================
//  DISPATCH DASHBOARD, DRIVER SCORECARD & CONTROL REPORTING
// =============================================================================

const getDispatchControlDashboard = async () => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [
      unassignedOrders,
      pendingRuns,
      assignedRuns,
      inProgressRuns,
      completedToday,
      partiallyCompletedToday,
      failedStopsAgg,
      activeDrivers,
      availableDrivers,
      vans,
      activeRuns,
    ] = await Promise.all([
      Order.countDocuments({
        $or: [{ driverId: null }, { driverId: { $exists: false } }, { driverId: '' }],
        status: { $in: ['Order Placed', 'Pending Pickup', 'Ready for Delivery', 'Awaiting Driver Arrival'] },
      }),
      Run.countDocuments({ overallStatus: 'Pending' }),
      Run.countDocuments({ overallStatus: 'Assigned' }),
      Run.countDocuments({ overallStatus: 'In Progress' }),
      Run.countDocuments({ overallStatus: 'Completed', actualCompletionDate: { $gte: todayStart } }),
      Run.countDocuments({ overallStatus: 'Partially Completed', actualCompletionDate: { $gte: todayStart } }),
      Run.aggregate([
        { $unwind: '$stops' },
        { $match: { 'stops.status': { $in: ['CUSTOMER_UNAVAILABLE', 'ISSUE_REPORTED', 'CANCELED'] } } },
        { $group: { _id: '$stops.status', count: { $sum: 1 } } },
      ]),
      User.countDocuments({ role: 'driver', status: 'active' }),
      User.countDocuments({ role: 'driver', status: 'active', isAvailableOnline: true }),
      Van.find({}).lean().catch(() => []),
      Run.find({ overallStatus: { $in: OPEN_RUN_STATUSES } })
        .populate({ path: 'driver', select: 'id name phone currentLocation' })
        .sort({ updatedAt: -1 })
        .limit(20),
    ]);

    const failedStops = failedStopsAgg.reduce((acc, item) => {
      acc[item._id] = item.count;
      acc.total += item.count;
      return acc;
    }, { total: 0 });

    const vanSummary = (vans || []).reduce((acc, van) => {
      const status = van.status || 'Unknown';
      acc.total += 1;
      acc.byStatus[status] = (acc.byStatus[status] || 0) + 1;
      return acc;
    }, { total: 0, byStatus: {} });

    const activeRunCards = activeRuns.map((run) => ({
      id: run.id,
      runCode: run.runCode,
      driverId: run.driverId,
      driverName: run.driver?.name || null,
      overallStatus: run.overallStatus,
      totalStops: run.totalStops || (run.stops || []).length,
      completedStops: run.completedStops || 0,
      failedDeliveryCount: run.failedDeliveryCount || 0,
      capacityStatus: run.capacityStatus || 'NOT_CONFIGURED',
      capacityUtilizationPct: run.capacityUtilizationPct || 0,
      estimatedLoadKg: run.estimatedLoadKg || 0,
      capacityKg: run.capacityKg || 0,
      routeOptimization: run.routeOptimization || null,
      updatedAt: run.updatedAt,
    }));

    return {
      summary: {
        unassignedOrders,
        pendingRuns,
        assignedRuns,
        inProgressRuns,
        completedToday,
        partiallyCompletedToday,
        failedStops: failedStops.total,
        activeDrivers,
        availableDrivers,
        vans: vanSummary.total,
      },
      failedStopsByReason: failedStops,
      vanSummary,
      activeRuns: activeRunCards,
      controls: {
        routeOrderingProtection: 'ACTIVE',
        coordinateMapping: 'deliveryLatitude/deliveryLongitude with address snapshot fallback',
        routeOptimization: 'nearest_neighbor',
        driverStartPoint: 'driver_current_location with fallback',
      },
    };
  } catch (error) {
    logger.error('[RUN_SERVICE] Error loading dispatch control dashboard:', error);
    throw new HttpError(500, 'Failed to load dispatch control dashboard.');
  }
};

const getDriverPerformanceScorecards = async (options = {}) => {
  try {
    const period = options.period || 'monthly';
    const now = new Date();
    const start = new Date(now);

    if (period === 'weekly') start.setDate(now.getDate() - 7);
    else if (period === 'monthly') start.setMonth(now.getMonth() - 1);
    else if (period === 'quarterly') start.setMonth(now.getMonth() - 3);
    else start.setFullYear(1970);

    const drivers = await User.find({ role: 'driver' }).select('id name phone driverProfile isAvailableOnline currentLocation').lean();

    const runs = await Run.find({
      updatedAt: { $gte: start },
      driverId: { $exists: true, $ne: null },
    }).lean();

    const deliveredOrders = await Order.find({
      status: 'Delivered',
      actualDeliveryTime: { $gte: start },
      driverId: { $exists: true, $ne: null },
    }).select('id driverId grandTotal createdAt actualDeliveryTime deliveredAt').lean();

    const revenueByDriver = deliveredOrders.reduce((acc, order) => {
      const key = order.driverId;
      acc[key] = acc[key] || { revenueGenerated: 0, deliveryMinutes: [] };
      acc[key].revenueGenerated += toNumber(order.grandTotal, 0);

      const startDate = order.createdAt ? new Date(order.createdAt) : null;
      const endDate = order.actualDeliveryTime || order.deliveredAt ? new Date(order.actualDeliveryTime || order.deliveredAt) : null;
      if (startDate && endDate && !Number.isNaN(startDate.getTime()) && !Number.isNaN(endDate.getTime())) {
        acc[key].deliveryMinutes.push(Math.max(0, Math.round((endDate - startDate) / 60000)));
      }

      return acc;
    }, {});

    const metricsByDriver = runs.reduce((acc, run) => {
      const key = run.driverId;
      acc[key] = acc[key] || {
        assignedRuns: 0,
        completedRuns: 0,
        totalStops: 0,
        deliveredStops: 0,
        failedStops: 0,
        optimizedRuns: 0,
      };

      acc[key].assignedRuns += 1;
      if (['Completed', 'Partially Completed'].includes(run.overallStatus)) acc[key].completedRuns += 1;
      acc[key].totalStops += (run.stops || []).length;
      acc[key].deliveredStops += (run.stops || []).filter((s) => s.status === 'DELIVERED').length;
      acc[key].failedStops += (run.stops || []).filter((s) => ['CUSTOMER_UNAVAILABLE', 'ISSUE_REPORTED', 'CANCELED'].includes(s.status)).length;
      if (run.routeOptimization?.optimized) acc[key].optimizedRuns += 1;

      return acc;
    }, {});

    return drivers.map((driver) => {
      const m = metricsByDriver[driver.id] || {};
      const rev = revenueByDriver[driver.id] || {};
      const totalStops = toNumber(m.totalStops, 0);
      const deliveredStops = toNumber(m.deliveredStops, 0);
      const failedStops = toNumber(m.failedStops, 0);
      const deliveryMinutes = rev.deliveryMinutes || [];
      const avgDeliveryTimeMinutes = deliveryMinutes.length
        ? Math.round(deliveryMinutes.reduce((a, b) => a + b, 0) / deliveryMinutes.length)
        : 0;

      return {
        id: driver.id,
        name: driver.name,
        phone: driver.phone,
        isAvailableOnline: !!driver.isAvailableOnline,
        totalDeliveries: deliveredStops,
        assignedRuns: toNumber(m.assignedRuns, 0),
        completedRuns: toNumber(m.completedRuns, 0),
        failedDeliveries: failedStops,
        issuesReported: failedStops,
        onTimeRate: totalStops > 0 ? round2((deliveredStops / totalStops) * 100) : 0,
        completionRate: totalStops > 0 ? round2(((deliveredStops + failedStops) / totalStops) * 100) : 0,
        optimizedRuns: toNumber(m.optimizedRuns, 0),
        revenueGenerated: round2(rev.revenueGenerated || 0),
        avgDeliveryTimeMinutes,
        rating: toNumber(driver.driverProfile?.averageRating, 0),
        ratingCount: toNumber(driver.driverProfile?.ratingCount, 0),
        vehicleModel: driver.driverProfile?.vehicleType || 'Fleet Vehicle',
      };
    });
  } catch (error) {
    logger.error('[RUN_SERVICE] Error loading driver performance scorecards:', error);
    throw new HttpError(500, 'Failed to load driver performance scorecards.');
  }
};

module.exports = {
  getPendingBatches,
  getActiveRuns,
  getUnassignedOrders,
  getRun,
  getAssignedRuns,
  driverUpdateStopStatus,
  createRunFromBatch,
  assignDriverToRun,
  updateRunCapacity,
  optimizeRunRoute,
  recordFailedDeliveryReason,
  endRun,
  getRunHistory,
  driverAcceptRun,
  acceptRun,
  getDispatchControlDashboard,
  getDriverPerformanceScorecards,
  // exported for orchestration/logistics reuse
  getOrderCoordinates,
  estimateOrderLoadKg,
  estimateRunLoadKgFromOrders,
  deriveCapacityStatus,
  optimizeStopsSequence,
};
