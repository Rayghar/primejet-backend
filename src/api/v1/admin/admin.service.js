// File: src/api/v1/admin/admin.service.js
const User = require('../../../models/user.model');
const Order = require('../../../models/order.model');
const Run = require('../../../models/run.model');
const HttpError = require('../../../utils/HttpError');
const { config, setActiveGateway } = require('../../../config');
const notificationService = require('../notifications/notification.service');
const { logger } = require('../../../config/logger.config');
const ServiceZone = require('../../../models/serviceZone.model');
const Address = require('../../../models/address.model');

/**
 * Helper function to check if a point is inside a polygon using the ray-casting algorithm.
 * @param {Array<number>} point - The point to check, as [longitude, latitude].
 * @param {Array<Array<number>>} polygon - An array of points defining the polygon's vertices.
 * @returns {boolean} - True if the point is inside the polygon.
 */
const isPointInPolygon = (point, polygon) => {
  const [x, y] = point;
  let isInside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) isInside = !isInside;
  }
  return isInside;
};

const getDashboardStats = async () => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

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
      
      const zone = await ServiceZone.findOne({ id: targetZoneId }).lean();
      if (!zone || !zone.area || !zone.area.coordinates || zone.area.coordinates.length === 0) {
        throw new HttpError(404, 'Service Zone not found or has no defined geographic area.');
      }
      
      const polygon = zone.area.coordinates[0];

      // 1. Calculate the bounding box for an efficient initial query
      const longitudes = polygon.map(p => p[0]);
      const latitudes = polygon.map(p => p[1]);
      const minLng = Math.min(...longitudes);
      const maxLng = Math.max(...longitudes);
      const minLat = Math.min(...latitudes);
      const maxLat = Math.max(...latitudes);

      // 2. Query the database for all addresses within the less-precise bounding box
      const addressesInBox = await Address.find({
        latitude: { $gte: minLat, $lte: maxLat },
        longitude: { $gte: minLng, $lte: maxLng },
      }).lean();

      if (addressesInBox.length === 0) {
        break; 
      }
      
      // 3. Filter the results precisely to see which are actually inside the polygon
      const addressesInZone = addressesInBox.filter(addr => {
        if (addr.longitude && addr.latitude) {
          return isPointInPolygon([addr.longitude, addr.latitude], polygon);
        }
        return false;
      });

      if (addressesInZone.length === 0) {
        break;
      }
      
      const userIdsInZone = [...new Set(addressesInZone.map(addr => addr.userId))];
      
      targetUsers = await User.find({ 
        id: { $in: userIdsInZone },
        role: 'customer'
      }).select('id').lean();
      break;

    default:
      throw new HttpError(400, 'Invalid notification target type specified.');
  }

  if (targetUsers.length === 0) {
    logger.warn(`[ADMIN_SERVICE] No users found for target type '${targetType}'.`);
    return { message: 'Notification task completed, but no users matched the criteria.' };
  }

  const userIds = [...new Set(targetUsers.map(u => u.id))];

  for (const userId of userIds) {
    await notificationService.createAndSendNotification(
      userId,
      title,
      body,
      'SYSTEM_ALERT',
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
  sendCustomNotification,
};