// src/api/v1/run_orchestration/run_orchestration.service.js
const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');
const Order = require('../../../models/order.model');
const Run = require('../../../models/run.model');
const User = require('../../../models/user.model');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config.js');
const { getOrderCoordinates, estimateOrderLoadKg } = require('../runs/run.service');

/**
 * Assigns a single order to an existing or new run for a specific driver.
 * This consolidates the logic previously in order.service.adminAssignDriver.
 */
const assignOrderToDriverRun = async (orderId, driverIdToAssign, adminPerformingActionId, session) => {
  try {
    const order = await Order.findOne({ id: orderId }).session(session);
    if (!order) {
      throw new HttpError(404, 'Order not found for driver assignment.');
    }
    if (order.status !== 'Order Placed' && order.status !== 'Processing') { // Only assign if eligible
      throw new HttpError(400, `Order status '${order.status}' is not eligible for direct assignment.`);
    }

    const driver = await User.findOne({ id: driverIdToAssign, role: 'driver' }).session(session);
    if (!driver) {
      throw new HttpError(404, `Driver with ID ${driverIdToAssign} not found or is not a driver.`);
    }

    // Try to find an existing 'Pending' or 'Assigned' run for the driver
    // This assumes a driver should typically only have one such run for new assignments
    let run = await Run.findOne({
      driverId: driverIdToAssign,
      overallStatus: { $in: ['Pending', 'Assigned'] },
    }).session(session);

    if (!run) {
      // If no existing run, create a new one
      run = new Run({
        id: uuidv4(),
        driverId: driverIdToAssign,
        overallStatus: 'Assigned', // Initially assigned, driver needs to accept
        stops: [],
        totalStops: 0,
        notes: `Run created by admin ${adminPerformingActionId} for driver ${driver.name}.`,
      });
      await run.save({ session }); // Save the new run to get its ID before linking
      logger.info(`[RUN_ORCHESTRATION] New run ${run.id} created for driver ${driver.name} (ID: ${driver.id}).`);
    }

    // Check if the order is already part of this run to prevent duplicates
    if (run.stops.some(s => s.orderId === order.id)) {
      throw new HttpError(400, `Order ${orderId} is already part of run ${run.id}.`);
    }

    const stopId = uuidv4();
    run.stops.push({
      stopId,
      orderId: order.id,
      sequence: run.stops.length + 1, // Simple sequence for now (can be optimized later)
      status: 'Pending', // Stop status within the run
      latitude: getOrderCoordinates(order).latitude,
      longitude: getOrderCoordinates(order).longitude,
      coordinateSource: getOrderCoordinates(order).source,
      estimatedLoadKg: estimateOrderLoadKg(order)
    });
    run.totalStops = run.stops.length;

    // Update the order details
    order.driverId = driverIdToAssign;
    order.runId = run.id; // Explicitly link order to run
    order.status = 'Driver Assigned'; // Order status update
    order.statusHistory.push({
      status: 'Driver Assigned',
      timestamp: new Date(),
      notes: `Assigned to driver ${driver.name} (ID: ${driver.id}) by admin. Added to Run ${run.id}.`,
      updatedBy: adminPerformingActionId,
      updaterRole: 'admin',
    });

    await run.save({ session });
    await order.save({ session });

    logger.info(`[RUN_ORCHESTRATION] Order ${orderId} added to run ${run.id} for driver ${driver.name}.`);
    return { run: run.toObject(), order: order.toObject() };

  } catch (error) {
    logger.error(`[RUN_ORCHESTRATION] Failed to assign order ${orderId} to driver ${driverIdToAssign}:`, { error: error.message, stack: error.stack });
    if (error instanceof HttpError) throw error;
    throw new HttpError(500, 'Failed to assign order to driver run.');
  }
};

/**
 * Creates a new run from a batch of orders.
 * This consolidates the logic previously in run.service.createRunFromBatch.
 */
const createBatchRun = async (orderIds, adminId, session) => {
  try {
    const ordersToBatch = await Order.find({ id: { $in: orderIds }, status: 'Order Placed' }).session(session);

    if (ordersToBatch.length !== orderIds.length) {
      throw new HttpError(400, 'One or more orders are not available for batching or do not exist.');
    }

    // Prevent orders already assigned to a driver or run from being batched
    for (const order of ordersToBatch) {
      if (order.driverId || order.runId) {
        throw new HttpError(400, `Order ${order.id} is already assigned to a driver or run and cannot be batched.`);
      }
    }

    // TODO: Add optional route optimization logic here to determine sequence
    const stops = ordersToBatch.map((order, index) => ({
      stopId: uuidv4(),
      orderId: order.id,
      sequence: index + 1, // Simple sequence for now
      status: 'Pending',
      latitude: getOrderCoordinates(order).latitude,
      longitude: getOrderCoordinates(order).longitude,
      coordinateSource: getOrderCoordinates(order).source,
      estimatedLoadKg: estimateOrderLoadKg(order),
    }));

    const newRun = new Run({
      id: uuidv4(),
      overallStatus: 'Pending', // Pending driver assignment
      stops: stops,
      totalStops: stops.length,
      estimatedLoadKg: stops.reduce((sum, stop) => sum + (Number(stop.estimatedLoadKg) || 0), 0),
      notes: `Run created by admin ${adminId} with ${stops.length} stops.`,
    });

    await newRun.save({ session });

    // Update the status of all batched orders and set runId
    await Order.updateMany(
      { id: { $in: orderIds } },
      {
        $set: {
          status: 'Processing', // A new status to indicate it's in a run
          runId: newRun.id // Set the runId on the orders
        }
      },
      { session }
    );

    logger.info(`[RUN_ORCHESTRATION] New batch run ${newRun.id} created by admin ${adminId} with ${stops.length} orders.`);
    return newRun.toObject();

  } catch (error) {
    logger.error(`[RUN_ORCHESTRATION] Failed to create batch run:`, { error: error.message, stack: error.stack, orderIds });
    if (error instanceof HttpError) throw error;
    throw new HttpError(500, 'Failed to create run from batch.');
  }
};

module.exports = {
  assignOrderToDriverRun,
  createBatchRun,
};