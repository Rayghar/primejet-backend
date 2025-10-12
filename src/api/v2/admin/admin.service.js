// File: src/api/v1/admin/admin.service.js
const User = require('../../../models/user.model');
const Order = require('../../../models/order.model');
const Run = require('../../../models/run.model');
const HttpError = require('../../../utils/HttpError');
const { config, setActiveGateway } = require('../../../config');

const getDashboardStats = async () => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Perform database queries in parallel for efficiency
    const [
      totalOrdersToday,
      pendingOrders,
      activeDeliveries,
      registeredCustomers,
      activeDrivers,
    ] = await Promise.all([
      Order.countDocuments({ createdAt: { $gte: today, $lt: tomorrow } }),
      Order.countDocuments({ status: { $in: ['Order Confirmed', 'Processing'] } }),
      Run.countDocuments({ overallStatus: 'In Progress' }),
      User.countDocuments({ role: 'customer' }),
      User.countDocuments({ role: 'driver', isAvailableOnline: true }),
    ]);

    return {
      totalOrdersToday,
      pendingOrders,
      activeDeliveries,
      registeredCustomers,
      activeDrivers,
    };
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    throw new HttpError(500, 'Could not retrieve dashboard statistics.');
  }
};

const getActiveGateway = () => {
    return {
        activePaymentGateway: config.activePaymentGateway,
    };
};

const updateActiveGateway = (gateway) => {
    if (!gateway) {
        throw new HttpError(400, 'Gateway name is required.');
    }
    const success = setActiveGateway(gateway);
    if (!success) {
        throw new HttpError(400, 'Invalid or unsupported gateway specified.');
    }
    return { message: `Active payment gateway successfully set to ${gateway}.` };
};

module.exports = {
  getDashboardStats,
  getActiveGateway,
  updateActiveGateway,

};