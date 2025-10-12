// File: src/api/v1/admin/admin.service.js
const User = require('../../../models/user.model');
const Order = require('../../../models/order.model');
const Run = require('../../../models/run.model');
const ServiceZone = require('../../../models/serviceZone.model'); // Import ServiceZone model
const HttpError = require('../../../utils/HttpError');
const { config, setActiveGateway } = require('../../../config');
const fcmService = require('../fcm/fcm.service'); // Import the FCM service

const getDashboardStats = async (req, res, next) => {
  try {
    const stats = await adminService.getDashboardStats();
    res.status(200).json(stats);
  } catch (error) {
    next(error);
  }
};

const getActivePaymentGateway = (req, res, next) => {
    try {
        const result = adminService.getActiveGateway();
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

const updateActivePaymentGateway = (req, res, next) => {
    try {
        const { gateway } = req.body;
        const result = adminService.updateActiveGateway(gateway);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

// ===== NEW CONTROLLER for sending notifications =====
const sendAdminNotification = async (req, res, next) => {
    try {
        const result = await adminService.sendTargetedNotification(req.body);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};
// ====================================================

module.exports = {
  getDashboardStats,
  getActivePaymentGateway,
  updateActivePaymentGateway,
  sendAdminNotification, // Export the new controller
  sendTargetedNotification, // Export the service function  
};