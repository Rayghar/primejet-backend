// src/api/v1/runs/run.service.js
const { v4: uuidv4 } = require('uuid');
const Run = require('../../../models/run.model');
const Order = require('../../../models/order.model');
const User = require('../../../models/user.model');
const HttpError = require('../../../utils/HttpError');
const mongoose = require('mongoose');
const { logger } = require('../../../config/logger.config.js');
const { createAndSendNotification } = require('../notifications/notification.service');

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
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const run = await Run.findOne({ id: runId }).session(session);

    if (!run) {
      throw new HttpError(404, 'Run not found.');
    }
    if (run.driverId !== driverId) {
      throw new HttpError(403, 'Not assigned to this driver.');
    }
    
    const stop = run.stops.find(s => s.stopId === stopId);
    if (!stop) {
      throw new HttpError(404, 'Stop not found in this run.');
    }
    
    stop.status = newStatus;
    stop.statusHistory.push({
      status: newStatus,
      timestamp: new Date(),
      notes: notes,
      updatedBy: driverId,
      updaterRole: 'driver'
    });

    // ======================= FIX STARTS HERE =======================
    // 1. Define what statuses mean a stop is "finished".
    // These should include all possible terminal states for a stop.
    const terminalStopStatuses = ['DELIVERED', 'CUSTOMER_UNAVAILABLE', 'ISSUE_REPORTED'];

    // 2. Recalculate the number of completed stops for the entire run.
    run.completedStops = run.stops.filter(s => terminalStopStatuses.includes(s.status)).length;
    
    logger.info(`[RUN_SERVICE] Recalculated completed stops for run ${runId}. New count: ${run.completedStops}`);
    // ======================== FIX ENDS HERE ========================

    const newOrderStatus = mapDriverStopStatusToOrderStatus(newStatus);
    if (newOrderStatus) {
      const order = await Order.findOne({ id: stop.orderId }).session(session);
      if (order) {
        order.status = newOrderStatus;
        order.statusHistory.push({
          status: newOrderStatus,
          timestamp: new Date(),
          notes: `Driver update: ${notes || newStatus}`,
          updatedBy: driverId,
          updaterRole: 'driver'
        });
        await order.save({ session });
        
        createAndSendNotification({
            userId: order.customerId,
            title: `Your Order is now ${newOrderStatus}`,
            body: `Your order #${order.shortOrderId} has been updated.`,
            type: 'ORDER_UPDATE',
            data: { orderId: order.id, screen: 'order_details' }
        });
      }
    }

    await run.save({ session }); // This now saves the updated completedStops count
    await session.commitTransaction();
    return { message: 'Stop status updated successfully.' };

  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

// --- Admin Focused Services ---

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
    // ======================= FIX IS HERE =======================
    // The query now accepts orders that are either 'Order Placed' OR 'Awaiting Driver Arrival'.
    const ordersToBatch = await Order.find({ 
      id: { $in: orderIds }, 
      status: { $in: ['Order Placed', 'Awaiting Driver Arrival'] } 
    }).session(session);
    // ===========================================================

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

    // Only update the status of 'Order Placed' orders. POA orders should remain as they are.
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
    // ========================== FIX IS HERE ==========================
    // The .populate() method now correctly uses the 'stops.order' virtual path,
    // which correctly joins the string-based UUIDs. The nested populate
    // to get the customer of each order within the run is also preserved.
    const run = await Run.findOne({ id: runId })
      .populate({
        path: 'driver',
        select: 'id name phone' 
      })
      .populate({
        path: 'stops.order', // <-- Use the new virtual field 'order' on the stop
        model: 'Order',
        select: 'id customerId recipientName status items deliveryAddressSnapshot deliveryLatitude deliveryLongitude',
        populate: { 
          path: 'customer', 
          model: 'User', 
          select: 'id name phone' 
        }
      });
    // ===============================================================

    if (!run) {
      throw new HttpError(404, 'Run not found.');
    }

    // Authorization check
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

    // ======================= INTELLIGENT LOGIC START =======================
    // Instead of a blind update, we now check each order individually.
    for (const stop of run.stops) {
      const order = await Order.findOne({ id: stop.orderId }).session(session);
      
      if (order) {
        // Step 1: Always assign the driver's ID to the order.
        order.driverId = newDriverId;

        // Step 2: Only change the status if it's NOT a "Pay on Arrival" order.
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
        // If the status IS 'Awaiting Driver Arrival', we do nothing to it.
        // It correctly remains in that special state for the driver to handle.
        
        await order.save({ session });
      }
    }
    // ======================== INTELLIGENT LOGIC END ========================
    
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

// --- Driver Focused Services ---

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
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const run = await Run.findOne({ id: runId }).session(session); // FIX IS HERE
    if (!run) {
      throw new HttpError(404, 'Run not found or not assigned to this driver.');
    }

    if (run.driverId !== driverId) { // FIX IS HERE
      throw new HttpError(403, 'Not assigned to this driver.');
    }
    
    // Check if run is already accepted
    if (run.overallStatus !== 'Assigned') {
      throw new HttpError(400, `This run is already '${run.overallStatus}'.`);
    }

    // Change run status to 'In Progress'
    run.overallStatus = 'In Progress';
    run.statusHistory.push({
      status: 'In Progress',
      timestamp: new Date(),
      notes: 'Driver accepted the run.',
      updatedBy: driverId,
      updaterRole: 'driver'
    });

    const driver = await User.findOne({ id: driverId }).session(session);
    if (!driver) {
      throw new HttpError(404, 'Driver profile not found.');
    }
    
    // Iterate through all stops in the run to update the associated orders
    for (const stop of run.stops) {
      const order = await Order.findOne({ id: stop.orderId }).session(session);
      if (order) {
        // === SURGICAL UPDATE FOR PAY ON ARRIVAL START ===
        // Only update the order status if it is NOT a "Pay on Arrival" order.
        // POA orders must remain in the 'Awaiting Driver Arrival' state.
        if (order.paymentMethod !== 'payOnPickup') {
          order.status = 'Driver Assigned'; 
          order.statusHistory.push({
            status: 'Driver Assigned',
            timestamp: new Date(),
            notes: `Order assigned to driver ${driver.name}.`,
            updatedBy: driverId,
            updaterRole: 'driver'
          });
          await order.save({ session });
          
          createAndSendNotification({
              userId: order.customerId,
              title: "Your Order is on its way!",
              body: `Your order has been assigned to a driver.`,
              type: 'ORDER_UPDATE',
              data: { orderId: order.id, screen: 'order_details' }
          });
        }
        // For POA orders, we do nothing to the status here. It remains 'Awaiting Driver Arrival'.
        // === SURGICAL UPDATE FOR PAY ON ARRIVAL END ===
      }
    }
    
    await run.save({ session });
    await session.commitTransaction();
    return { message: 'Run accepted and order status updated successfully.' };

  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
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