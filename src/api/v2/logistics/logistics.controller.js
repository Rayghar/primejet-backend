// src/api/v2/logistics/logistics.controller.js
const mongoose = require('mongoose');
const Order = require('../../../models/order.model');
const User = require('../../../models/user.model'); // For driver info
const Van = require('../../../models/van.model'); // Assuming a Van model
const Run = require('../../../models/run.model'); // Assuming a Run model
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');

/**
 * @desc Assigns an unassigned order to a specific van and creates a new run.
 * This logic mirrors `adminAssignDriver` from v1 order service and `assignOrderToVan` from v1 run service.
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 * @param {function} next - Express next middleware function.
 */
const assignOrderToVan = async (req, res, next) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const { orderId, vanId } = req.body;
        const adminId = req.user.id;
        const adminEmail = req.user.email;

        // 1. Fetch Order and Van
        const order = await Order.findOne({ id: orderId, status: { $in: ['Order Placed', 'Pending Pickup', 'Ready for Delivery'] } }).session(session);
        if (!order) {
            throw new HttpError(404, 'Order not found or not in a state to be assigned.');
        }
        if (order.driverId) {
            throw new HttpError(400, `Order ${orderId} is already assigned to a driver.`);
        }

        const van = await Van.findOne({ id: vanId, status: 'Idle' }).session(session);
        if (!van) {
            throw new HttpError(404, 'Van not found or not available.');
        }

        const driver = await User.findOne({ id: van.driverId, role: 'driver' }).session(session);
        if (!driver) {
            throw new HttpError(404, `Driver associated with Van ${van.vanNumber} not found.`);
        }

        // 2. Update Order Status and Assign Driver
        order.driverId = van.driverId;
        order.status = 'Driver Assigned';
        order.statusHistory.push({
            status: 'Driver Assigned',
            timestamp: new Date(),
            notes: `Assigned to driver ${driver.name} (Van ${van.vanNumber}) by ${adminEmail}.`,
            updatedBy: adminId,
            updaterRole: 'admin'
        });
        await order.save({ session });

        // 3. Update Van Status
        van.status = 'On Delivery';
        van.currentOrderId = orderId; // Link van to the order it's delivering
        await van.save({ session });

        // 4. Create a new Run document for this assignment
        const newRun = new Run({
            id: new mongoose.Types.ObjectId().toString(),
            driverId: van.driverId,
            overallStatus: 'Assigned',
            stops: [{
                stopId: new mongoose.Types.ObjectId().toString(),
                orderId: order.id,
                sequence: 1, // First stop in this run
                status: 'Pending',
                latitude: order.deliveryLatitude,
                longitude: order.deliveryLongitude,
            }],
            totalStops: 1,
            notes: `Run created for Order #${order.id.substring(0, 8)} assigned to Van ${van.vanNumber}.`,
            estimatedStartDate: new Date(), // Set to now or a planned time
        });
        await newRun.save({ session });

        logger.info(`Order ${orderId} assigned to Van ${van.vanNumber} (Driver: ${driver.name}). New Run ID: ${newRun.id}`);

        await session.commitTransaction();
        res.status(200).json({ message: `Order ${orderId} assigned successfully to Van ${van.vanNumber}.` });

    } catch (error) {
        await session.abortTransaction();
        logger.error('Error assigning order to van:', error);
        next(new HttpError(500, error.message || 'Failed to assign order to van.'));
    } finally {
        session.endSession();
    }
};

module.exports = {
    assignOrderToVan,
};