// src/api/v1/runs/run.service.js
const { v4: uuidv4 } = require('uuid');
const Run = require('../../../models/run.model');
const Order = require('../../../models/order.model');
const User = require('../../../models/user.model');
const HttpError = require('../../../utils/HttpError');
const mongoose = require('mongoose');
const { logger } = require('../../../config/logger.config.js');

// ✅ FIX: Import the notification service to be used for sending push notifications.
const notificationService = require('../notifications/notification.service');

// Helper function to translate driver statuses to customer-facing order statuses
const mapDriverStopStatusToOrderStatus = (driverStopStatus) => {
  const mapping = {
    'DRIVER_ENROUTE_PICKUP': 'Processing',
    'PICKED_UP_ENROUTE_STATION': 'Processing',
    'CYLINDER_REFILLING': 'Processing',
    'OUT_FOR_DELIVERY': 'Out for Delivery',
    'DELIVERED': 'Delivered',
    'CUSTOMER_UNAVAILABLE': 'Customer Unavailable'
  };
  return mapping[driverStopStatus] || null;
};

const driverUpdateStopStatus = async (driverId, runId, stopId, newStatus, notes) => {
  const run = await Run.findOne(
    { id: runId, driverId },
    { stops: 1, overallStatus: 1, id: 1 }
  ).lean();

  if (!run) {
    throw new HttpError(404, 'Run not found or not assigned to this driver.');
  }

  const stop = (run.stops || []).find(s => s.stopId === stopId);
  if (!stop) {
    throw new HttpError(404, 'Stop not found in this run.');
  }
  const orderId = stop.orderId;

  const now = new Date();
  const updateRes = await Run.updateOne(
    { id: runId, driverId },
    {
      $set: { 'stops.$[s].status': newStatus },
      $push: {
        'stops.$[s].statusHistory': {
          status: newStatus,
          timestamp: now,
          notes,
          updatedBy: driverId,
          updaterRole: 'driver',
        }
      }
    },
    {
      arrayFilters: [{ 's.stopId': stopId }],
      upsert: false
    }
  );

  const matched = updateRes.matchedCount ?? updateRes.n ?? 0;
  if (matched === 0) {
    throw new HttpError(409, 'Stop status not updated (possibly changed concurrently). Please retry.');
  }

  try {
    const mappedStatus = mapDriverStopStatusToOrderStatus(newStatus);
    if (mappedStatus) {
      const order = await Order.findOne({ id: orderId });
      if (order) {
        const oldStatus = order.status;
        order.status = mappedStatus;
        order.statusHistory.push({
          status: mappedStatus,
          timestamp: now,
          notes: `Driver updated stop (${stopId}) to ${newStatus}`,
          updatedBy: driverId,
          updaterRole: 'driver'
        });
        await order.save();

        // ✅ FIX: Trigger a push notification to the customer if the status changed.
        if (oldStatus !== mappedStatus) {
          logger.info(`[RUN_SERVICE] Triggering notification for order ${order.id} status change to ${mappedStatus}`);
          await notificationService.createAndSendNotification(
            order.customerId,
            'Order Update',
            `Your order status is now: ${mappedStatus}`,
            'ORDER_UPDATE',
            { orderId: order.id, screen: 'order_details' }
          );
        }
      }
    }
  } catch (err) {
    logger?.error?.('[RUN_SERVICE] Order status update and notification failed:', err);
  }

  try {
    const terminalStopStatuses = ['DELIVERED', 'CUSTOMER_UNAVAILABLE', 'ISSUE_REPORTED', 'CANCELED'];
    const fresh = await Run.findOne({ id: runId }, { stops: 1, overallStatus: 1, id: 1 }).lean();

    const allDone = (fresh.stops || []).every(s => terminalStopStatuses.includes(s.status));
    if (allDone && fresh.overallStatus !== 'Completed') {
      await Run.updateOne(
        { id: runId },
        {
          $set: { overallStatus: 'Completed' },
          $push: {
            statusHistory: {
              status: 'Completed',
              timestamp: now,
              notes: 'All stops reached terminal state',
              updatedBy: driverId,
              updaterRole: 'driver'
            }
          }
        }
      );
    }
  } catch (err) {
    logger?.error?.('[RUN_SERVICE] Could not finalize run to Completed:', err);
  }

  const updatedRun = await Run.findOne({ id: runId }).lean();
  return updatedRun;
};

// --- Admin Focused Services ---
// NOTE: All other functions in this file remain unchanged.
// The code below is identical to your original file.

const getPendingBatches = async () => {
  try {
    const pendingRuns = await Run.find({ overallStatus: 'Pending' })
      .sort({ createdAt: -1 });
    return pendingRuns.map(run => run.toObject());
  } catch (error) {
    logger.error('[RUN_SERVICE] Error fetching pending batches:', error);
    throw new HttpError(500, 'Failed to retrieve pending batches.');
  }
};

const createRunFromBatch = async (orderIds, adminId) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const ordersToBatch = await Order.find({ 
      id: { $in: orderIds }, 
      status: { $in: ['Order Placed', 'Awaiting Driver Arrival'] } 
    }).session(session);

    if (ordersToBatch.length !== orderIds.length) {
      throw new HttpError(400, 'One or more orders are not available for batching or do not exist.');
    }

    const stops = ordersToBatch.map((order, index) => ({
      stopId: uuidv4(),
      orderId: order.id,
      sequence: index + 1,
      status: 'Pending',
      latitude: order.deliveryLatitude,
      longitude: order.deliveryLongitude,
    }));

    const newRun = new Run({
      id: uuidv4(),
      overallStatus: 'Pending',
      stops: stops,
      totalStops: stops.length,
      notes: `Run created by admin ${adminId} with ${stops.length} stops.`
    });

    await newRun.save({ session });

    const orderIdsToUpdate = ordersToBatch
      .filter(order => order.status === 'Order Placed')
      .map(order => order.id);

    if (orderIdsToUpdate.length > 0) {
      await Order.updateMany(
        { id: { $in: orderIdsToUpdate } },
        { $set: { status: 'Processing' } },
        { session }
      );
    }

    await session.commitTransaction();
    return newRun.toObject();

  } catch (error) {
    await session.abortTransaction();
    logger.error('Error creating run from batch:', error);
    if (error instanceof HttpError) throw error;
    throw new HttpError(500, 'Failed to create run from batch.');
  } finally {
    session.endSession();
  }
};

const getActiveRuns = async () => {
  try {
    const activeRuns = await Run.find({ overallStatus: { $in: ['Assigned', 'In Progress'] } })
      .populate('driver')
      .sort({ updatedAt: -1 });
    return activeRuns.map(run => run.toObject());
  } catch (error) {
    logger.error('Unexpected error in getActiveRuns:', error);
    throw new HttpError(500, 'Failed to retrieve active runs.');
  }
};

const getUnassignedOrders = async (options) => {
  const { page = 1, limit = 10 } = options;
  try {
    const query = {
      driverId: null,
      status: { $in: ['Order Placed', 'Pending Pickup', 'Ready for Delivery'] }
    };

    const totalOrders = await Order.countDocuments(query);
    const orders = await Order.find(query)
      .sort({ orderDate: 1 })
      .skip((page - 1) * limit)
      .limit(limit);

    return {
      orders: orders.map(order => order.toObject()),
      currentPage: page,
      totalPages: Math.ceil(totalOrders / limit),
      totalOrders,
    };
  } catch (error) {
    logger.error('[RUN_SERVICE] Error fetching unassigned orders:', error);
    throw new HttpError(500, 'Failed to retrieve unassigned orders.');
  }
};

const getRun = async (runId, requestingUser) => {
  try {
    const run = await Run.findOne({ id: runId })
      .populate({
        path: 'driver',
        select: 'id name phone' 
      })
      .populate({
        path: 'stops.order',
        model: 'Order',
        populate: { 
          path: 'customer',
          model: 'User', 
          select: 'id name phone' 
        }
      });

    if (!run) {
      throw new HttpError(404, 'Run not found.');
    }

    if (requestingUser.role === 'driver' && run.driver?.id !== requestingUser.id) {
      throw new HttpError(403, 'You are not authorized to access this run.');
    }

    return run.toObject();
  } catch (error) {
    logger.error(`Unexpected error in getRun for runId ${runId}:`, error);
    if (error instanceof HttpError) throw error;
    throw new HttpError(500, 'Failed to retrieve run details.');
  }
};

const assignDriverToRun = async (runId, newDriverId, adminPerformingActionId) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const run = await Run.findOne({ id: runId }).session(session);
    if (!run) {
      throw new HttpError(404, 'Run not found for assignment.');
    }
    if (run.overallStatus !== 'Pending') {
        throw new HttpError(400, `This run is already '${run.overallStatus}' and cannot be assigned.`);
    }

    const newDriver = await User.findOne({ id: newDriverId, role: 'driver' }).session(session);
    if (!newDriver) {
      throw new HttpError(404, `Driver with ID ${newDriverId} not found or is not a driver.`);
    }

    run.driverId = newDriverId;
    run.overallStatus = 'Assigned';
    
    for (const stop of run.stops) {
      const order = await Order.findOne({ id: stop.orderId }).session(session);
      
      if (order) {
        order.driverId = newDriverId;

        if (order.status !== 'Awaiting Driver Arrival') {
          order.status = 'Driver Assigned';
          order.statusHistory.push({
            status: 'Driver Assigned',
            timestamp: new Date(),
            notes: `Assigned to driver ${newDriver.name} (ID: ${newDriverId}) by admin.`,
            updatedBy: adminPerformingActionId,
            updaterRole: 'admin'
          });
        }
        
        await order.save({ session });
      }
    }
    
    await run.save({ session });
    await session.commitTransaction();

    logger.info(`[RUN_SERVICE] Run ${run.id} successfully assigned to driver ${newDriver.id}.`);
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

const getAssignedRuns = async (driverId) => {
  try {
    const runs = await Run.find({
        driverId: driverId,
        overallStatus: { $in: ['Assigned', 'In Progress'] } 
      })
      .populate('driver') 
      .sort({ createdAt: -1 });
    return runs.map(run => run.toObject());
  } catch (error) {
    logger.error('Unexpected error in getAssignedRuns:', error);
    throw new HttpError(500, 'Failed to retrieve assigned runs.');
  }
};

const endRun = async (runId, driverId) => {
    const run = await Run.findOne({ id: runId, driverId: driverId });
    if (!run) {
        throw new HttpError(404, 'Run not found or not assigned to you.');
    }

    if (run.completedStops < run.totalStops) {
        throw new HttpError(400, `Cannot end run. Only ${run.completedStops} of ${run.totalStops} stops are completed.`);
    }

    if (run.overallStatus === 'Completed') {
        return { message: 'This run has already been completed.' };
    }

    run.overallStatus = 'Completed';
    run.actualCompletionDate = new Date();
    await run.save();

    logger.info(`[RUN_SERVICE] Run ${runId} successfully ended by driver ${driverId}.`);
    return { message: 'Run successfully marked as completed.' };
};

const driverAcceptRun = async (driverId, runId) => {
  const run = await Run.findOneAndUpdate(
    { id: runId, driverId, overallStatus: 'Assigned' },
    {
      $set: { overallStatus: 'In Progress' },
      $push: {
        statusHistory: {
          status: 'In Progress',
          timestamp: new Date(),
          notes: 'Driver accepted the run.',
          updatedBy: driverId,
          updaterRole: 'driver'
        }
      }
    },
    { new: true }
  );

  if (!run) {
    throw new HttpError(400, 'Run not found, not assigned to you, or already accepted.');
  }

  const orderIds = (run.stops || []).map(s => s.orderId).filter(Boolean);

  if (!orderIds.length) {
    return { message: 'Run accepted. No orders to update.' };
  }

  const orders = await Order.find(
    { id: { $in: orderIds }, paymentMethod: { $ne: 'payOnPickup' } },
    { id: 1, customerId: 1 }
  ).lean();

  if (orders.length) {
    const ops = orders.map(o => ({
      updateOne: {
        filter: { id: o.id },
        update: {
          $set: { status: 'Driver Assigned' },
          $push: {
            statusHistory: {
              status: 'Driver Assigned',
              timestamp: new Date(),
              notes: 'Order assigned to driver.',
              updatedBy: driverId,
              updaterRole: 'driver'
            }
          }
        }
      }
    }));

    await Order.bulkWrite(ops, { ordered: false });

    for (const o of orders) {
      try {
        await notificationService.createAndSendNotification(
          o.customerId,
          'Your Order is on its way!',
          'Your order has been assigned to a driver.',
          'ORDER_UPDATE',
          { orderId: o.id, screen: 'order_details' }
        );
      } catch (err) {
        try { logger.error?.('[RUN_SERVICE] Notification error:', err); } catch (_) {}
      }
    }
  }

  return { message: 'Run accepted and order status updated successfully.' };
};

const getRunHistory = async (driverId, options) => {
  try {
    const { page = 1, limit = 15 } = options;
    const query = {
      driverId: driverId,
      overallStatus: 'Completed'
    };

    const totalRuns = await Run.countDocuments(query);
    
    const runs = await Run.find(query)
      .sort({ actualCompletionDate: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate({
        path: 'stops.order',
        model: 'Order',
        select: 'recipientName deliveryAddressSnapshot feedback'
      });

    return {
      runs: runs.map(run => run.toObject()),
      currentPage: parseInt(page, 10),
      totalPages: Math.ceil(totalRuns / limit),
    };
  } catch (error) {
    logger.error(`[RUN_SERVICE] Error fetching run history for driver ${driverId}:`, error);
    throw new HttpError(500, 'Failed to retrieve delivery history.');
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
  endRun,
  getRunHistory,
  driverAcceptRun
};