// src/api/v1/run_orchestration/run_orchestration.controller.js
const runOrchestrationService = require('./run_orchestration.service');
const HttpError = require('../../../utils/HttpError');
const mongoose = require('mongoose');

// Controller method for admin to assign an order to a driver/run
const adminAssignOrderToDriver = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { orderId } = req.params;
    const { driverId } = req.body;
    const adminId = req.user.id; // Assuming user ID is available from auth middleware
    const adminRole = req.user.role;

    if (adminRole !== 'admin') {
      throw new HttpError(403, 'Only admins can assign drivers to orders.');
    }

    const { run, order } = await runOrchestrationService.assignOrderToDriverRun(orderId, driverId, adminId, session);
    
    await session.commitTransaction();
    res.status(200).json({ message: `Order ${order.id} assigned to driver ${driverId} in run ${run.id}.`, run, order });
  } catch (error) {
    await session.abortTransaction();
    next(error instanceof HttpError ? error : new HttpError(500, `Failed to assign order to driver: ${error.message}`));
  } finally {
    session.endSession();
  }
};

// Controller method for admin to create a run from a batch of orders
const adminCreateRunFromOrders = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { orderIds } = req.body;
    const adminId = req.user.id; // Assuming user ID is available from auth middleware

    const newRun = await runOrchestrationService.createBatchRun(orderIds, adminId, session);

    await session.commitTransaction();
    res.status(201).json(newRun);
  } catch (error) {
    await session.abortTransaction();
    next(error instanceof HttpError ? error : new HttpError(500, `Failed to create run from orders: ${error.message}`));
  } finally {
    session.endSession();
  }
};


module.exports = {
  adminAssignOrderToDriver,
  adminCreateRunFromOrders,
};