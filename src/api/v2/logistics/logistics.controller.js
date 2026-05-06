// src/api/v2/logistics/logistics.controller.js
const mongoose = require('mongoose');
const Order = require('../../../models/order.model');
const User = require('../../../models/user.model');
const Van = require('../../../models/van.model');
const Run = require('../../../models/run.model');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');
const { getOrderCoordinates, estimateOrderLoadKg, deriveCapacityStatus } = require('../runs/run.service');

// helper for lenient payment checks
const normalize = (v) => String(v || '').trim().toLowerCase();
const isUnassignablePaymentStatus = (paymentStatus) => {
  const s = normalize(paymentStatus);
  return [
    'pending',
    'processing (gateway)',
    'processing',
    'verifying',
    'verifying payment',
    'awaiting payment',
    'unpaid',
    'failed',
  ].includes(s);
};

/**
 * @desc Assigns an unassigned order to a specific van and creates a new run.
 */
const assignOrderToVan = async (req, res, next) => {
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      const { orderId, vanId } = req.body;

      if (!orderId || !vanId) {
        throw new HttpError(400, 'orderId and vanId are required.');
      }

      const adminId = req.user?.id;
      const adminEmail = req.user?.email || 'admin';

      // 1) Fetch Order (eligibility + lock in txn)
      const order = await Order.findOne({
        id: orderId,
        status: { $nin: ['Delivered', 'Canceled', 'Cancelled', 'Failed'] },
      }).session(session);

      if (!order) {
        throw new HttpError(404, 'Order not found or not eligible for assignment.');
      }

      if (order.driverId) {
        throw new HttpError(400, `Order ${orderId} is already assigned to a driver.`);
      }

      if (isUnassignablePaymentStatus(order.paymentStatus)) {
        throw new HttpError(400, `Order ${orderId} is not eligible for assignment until payment is confirmed.`);
      }

      // Prevent duplicate active runs for same order
      const existingRun = await Run.findOne({
        'stops.orderId': orderId,
        overallStatus: { $nin: ['Completed', 'Cancelled', 'Canceled'] },
      }).session(session);

      if (existingRun) {
        throw new HttpError(400, `Order ${orderId} already has an active run.`);
      }

      // 2) Fetch Van (must be idle)
      const van = await Van.findOne({ id: vanId, status: 'Idle' }).session(session);
      if (!van) {
        throw new HttpError(404, 'Van not found or not available.');
      }

      // 3) Fetch driver for that van
      if (!van.driverId) {
        throw new HttpError(400, `Van ${van.vanNumber || vanId} has no driver assigned.`);
      }

      const driver = await User.findOne({ id: van.driverId, role: 'driver' }).session(session);
      if (!driver) {
        throw new HttpError(404, `Driver associated with Van ${van.vanNumber || vanId} not found.`);
      }

      // 4) Update Order: assign driver + status history
      order.driverId = van.driverId;
      order.status = 'Driver Assigned';

      if (!Array.isArray(order.statusHistory)) order.statusHistory = [];
      order.statusHistory.push({
        status: 'Driver Assigned',
        timestamp: new Date(),
        notes: `Assigned to driver ${driver.name || driver.email || van.driverId} (Van ${van.vanNumber || vanId}) by ${adminEmail}.`,
        updatedBy: adminId,
        updaterRole: 'admin',
      });

      await order.save({ session });

      // 5) Update Van status
      van.status = 'On Delivery';
      van.currentOrderId = orderId;
      await van.save({ session });

      // 6) Create Run
      const newRun = new Run({
        id: new mongoose.Types.ObjectId().toString(),
        driverId: van.driverId,
        vanId: van.id,
        overallStatus: 'Assigned',
        estimatedLoadKg: estimateOrderLoadKg(order),
        capacityKg: Number(van.capacityKg || van.loadCapacityKg || van.capacity || 0),
        capacityStatus: deriveCapacityStatus(estimateOrderLoadKg(order), Number(van.capacityKg || van.loadCapacityKg || van.capacity || 0)).capacityStatus,
        capacityUtilizationPct: deriveCapacityStatus(estimateOrderLoadKg(order), Number(van.capacityKg || van.loadCapacityKg || van.capacity || 0)).capacityUtilizationPct,
        capacityVarianceKg: deriveCapacityStatus(estimateOrderLoadKg(order), Number(van.capacityKg || van.loadCapacityKg || van.capacity || 0)).capacityVarianceKg,
        stops: [
          {
            stopId: new mongoose.Types.ObjectId().toString(),
            orderId: order.id,
            sequence: 1,
            status: 'Pending',
            latitude: getOrderCoordinates(order).latitude,
            longitude: getOrderCoordinates(order).longitude,
            coordinateSource: getOrderCoordinates(order).source,
            estimatedLoadKg: estimateOrderLoadKg(order),
          },
        ],
        totalStops: 1,
        notes: `Run created for Order #${String(order.id).substring(0, 8)} assigned to Van ${van.vanNumber || vanId}.`,
        estimatedStartDate: new Date(),
      });

      await newRun.save({ session });

      van.currentRunId = newRun.id;
      await van.save({ session });

      logger.info(
        `Order ${orderId} assigned to Van ${van.vanNumber || vanId} (Driver: ${driver.name || driver.email}). New Run ID: ${newRun.id}`
      );

      res.status(200).json({
        message: `Order ${orderId} assigned successfully to Van ${van.vanNumber || vanId}.`,
        runId: newRun.id,
      });
    });
  } catch (error) {
    if (error instanceof HttpError) {
      logger.warn(`[LOGISTICS] ${error.statusCode} - ${error.message}`);
      return next(error);
    }

    logger.error('Error assigning order to van:', error);
    return next(new HttpError(500, error.message || 'Failed to assign order to van.'));
  } finally {
    session.endSession();
  }
};

module.exports = {
  assignOrderToVan,
};
