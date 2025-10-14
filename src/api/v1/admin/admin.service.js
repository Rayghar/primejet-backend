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
      if (!targetZoneId) {
        throw new HttpError(400, 'Service Zone ID is required for this target type.');
      }
      // 1. Find the service zone's geometry from the database.
      // This assumes the zone's GeoJSON data is stored in a field named 'area'.
      const zone = await ServiceZone.findOne({ id: targetZoneId }).lean();
      if (!zone || !zone.area || !zone.area.coordinates) {
        throw new HttpError(404, 'Service Zone not found or has no defined geographic area.');
      }

      // 2. Find all addresses that are geographically within that zone's area.
      // This assumes the Address model has a 'location' field indexed for 2dsphere queries.
      const addressesInZone = await Address.find({
        location: {
          $geoWithin: {
            $geometry: zone.area,
          },
        },
      }).select('userId').lean();

      if (addressesInZone.length === 0) {
        break; // No users in this zone, so we can exit the case.
      }

      // 3. Extract the unique user IDs from the addresses found.
      const userIdsInZone = [...new Set(addressesInZone.map(addr => addr.userId))];

      // 4. Fetch the full user objects for those IDs, ensuring they are customers.
      targetUsers = await User.find({ 
        id: { $in: userIdsInZone },
        role: 'customer' // Double-check that we are only targeting customers.
      }).select('id').lean();
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