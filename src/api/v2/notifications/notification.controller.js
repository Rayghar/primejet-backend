// File: src/api/v1/notifications/notification.controller.js
const notificationService = require('./notification.service');
const HttpError = require('../../../utils/HttpError');

const adminSendNotification = async (req, res, next) => {
  try {
    // req.body is already validated by Joi (sendNotificationSchema)
    const result = await notificationService.adminSendNotification(req.body);
    res.status(200).json(result);
  } catch(error) {
    next(error);
  }
};

const getMyNotifications = async (req, res, next) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const result = await notificationService.getMyNotifications(req.user.id, {
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

const markNotificationAsRead = async (req, res, next) => {
  try {
    const { notificationId } = req.params;
    await notificationService.markNotificationAsRead(notificationId, req.user.id);
    res.status(200).json({ message: 'Notification marked as read.' });
  } catch (error) {
    next(error);
  }
};

const markAllNotificationsAsRead = async (req, res, next) => {
  try {
    await notificationService.markAllNotificationsAsRead(req.user.id);
    res.status(200).json({ message: 'All notifications marked as read.' });
  } catch (error) {
    next(error);
  }
};

const deleteNotification = async (req, res, next) => {
  try {
    const { notificationId } = req.params;
    await notificationService.deleteNotification(notificationId, req.user.id);
    res.status(200).json({ message: 'Notification deleted successfully.' });
  } catch (error) {
    next(error);
  }
};

const clearAllNotifications = async (req, res, next) => {
  try {
    await notificationService.clearAllNotifications(req.user.id);
    res.status(200).json({ message: 'All notifications cleared successfully.' });
  } catch (error) {
    next(error);
  }
};


module.exports = {
  adminSendNotification,
  getMyNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification,
  clearAllNotifications,
};