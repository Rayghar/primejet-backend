// File: src/api/v1/admin/admin.service.js
const User = require('../../../models/user.model');
const Order = require('../../../models/order.model');
const Run = require('../../../models/run.model');
const HttpError = require('../../../utils/HttpError');
const { config, setActiveGateway } = require('../../../config');
const notificationService = require('../notifications/notification.service'); // 👈 Add this
const { logger } = require('../../../config/logger.config'); // 👈 Add this for logging


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

// ✨ NEW SERVICE FUNCTION
const sendCustomNotification = async (payload) => {
  const { title, body, targetType, targetUserId, targetZoneId } = payload;
  let targetUsers = [];

  logger.info(`[ADMIN_SERVICE] Initiating custom notification send for target: ${targetType}`);

  switch (targetType) {
    case 'allCustomers':
      targetUsers = await User.find({ role: 'customer' }).select('id').lean();
      break;
    case 'allDrivers':
      targetUsers = await User.find({ role: 'driver' }).select('id').lean();
      break;
    case 'allUsers':
      targetUsers = await User.find({ role: { $in: ['customer', 'driver'] } }).select('id').lean();
      break;
    case 'singleUser':
      if (targetUserId) {
        const user = await User.findOne({ id: targetUserId }).select('id').lean();
        if (user) targetUsers.push(user);
      }
      break;
    case 'byZone':
      // This is an assumption. It assumes you can query users based on a zone.
      // You may need to adjust this query based on your actual User schema
      // (e.g., if a user's address is linked to a zone).
      // For now, we assume a direct 'zoneId' field on the User model for simplicity.
      logger.warn(`[ADMIN_SERVICE] 'byZone' targeting is not fully implemented. Requires user schema with zone relationship.`);
      // Example placeholder: targetUsers = await User.find({ zoneId: targetZoneId, role: 'customer' }).select('id').lean();
      break;
    default:
      throw new HttpError(400, 'Invalid notification target type specified.');
  }

  if (targetUsers.length === 0) {
    logger.warn(`[ADMIN_SERVICE] No users found for target type '${targetType}'.`);
    return { message: 'Notification task completed, but no users matched the criteria.' };
  }

  // Use a set to ensure unique user IDs
  const userIds = [...new Set(targetUsers.map(u => u.id))];

  // Sequentially trigger notifications. For a very large user base,
  // this should be moved to a background job queue (e.g., BullMQ).
  for (const userId of userIds) {
    // We reuse the existing, stable notification service. This is the key!
    await notificationService.createAndSendNotification(
      userId,
      title,
      body,
      'SYSTEM_ALERT', // A generic type for admin messages
      { from: 'admin' }
    );
  }

  logger.info(`[ADMIN_SERVICE] Successfully queued notifications for ${userIds.length} users.`);
  return { message: `Notification has been sent to ${userIds.length} users.` };
};


module.exports = {
  getDashboardStats,
  getActiveGateway,
  updateActiveGateway,
  sendCustomNotification, // 👈 Export the new function

};