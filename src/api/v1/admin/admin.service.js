// File: src/api/v1/admin/admin.service.js
const User = require('../../../models/user.model');
const Order = require('../../../models/order.model');
const Run = require('../../../models/run.model');
const HttpError = require('../../../utils/HttpError');
const { config, setActiveGateway } = require('../../../config');
const fcmService = require('../fcm/fcm.service'); // Import the FCM service
const ServiceZone = require('../../../models/serviceZone.model'); // Import ServiceZone model

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
      // ✅ FIX: Changed 'overallStatus' to 'status'. This was the likely cause of the 500 error.
      Run.countDocuments({ status: 'In Progress' }),
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
    // This console.error is important for debugging future issues.
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

const sendTargetedNotification = async (payload) => {
    const { title, body, targetType, targetUserId, targetZoneId, data } = payload;
    let userIds = [];

    switch (targetType) {
        case 'singleUser':
            if (!targetUserId) throw new HttpError(400, 'targetUserId is required for single user notifications.');
            userIds.push(targetUserId);
            break;
        case 'allCustomers':
            const allCustomers = await User.find({ role: 'customer' }).select('id').lean();
            userIds = allCustomers.map(u => u.id);
            break;
        case 'allDrivers':
            const allDrivers = await User.find({ role: 'driver' }).select('id').lean();
            userIds = allDrivers.map(u => u.id);
            break;
        case 'allUsers':
            const allUsers = await User.find({}).select('id').lean();
            userIds = allUsers.map(u => u.id);
            break;
        case 'byZone':
            if (!targetZoneId) throw new HttpError(400, 'targetZoneId is required for zone-based notifications.');
            const zone = await ServiceZone.findOne({ id: targetZoneId }).lean();
            if (!zone) throw new HttpError(404, 'Service zone not found.');

            // Find users whose default address is within the zone's polygon
            const usersInZone = await User.find({
                role: 'customer',
                'defaultAddress.location': {
                    $geoWithin: {
                        $geometry: zone.area
                    }
                }
            }).select('id').lean();
            userIds = usersInZone.map(u => u.id);
            break;
        default:
            throw new HttpError(400, 'Invalid notification target type specified.');
    }

    if (userIds.length === 0) {
        return { message: 'Notification sent successfully to 0 users (no targets found).' };
    }

    // Loop and send notification to each user.
    for (const userId of userIds) {
        await fcmService.sendNotificationToUser(userId, { title, body, data });
    }

    return { message: `Notification successfully sent to ${userIds.length} users.` };
};

module.exports = {
  getDashboardStats,
  getActiveGateway,
  updateActiveGateway,
  sendTargetedNotification,
};