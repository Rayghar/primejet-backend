// File: src/api/v1/admin/admin.controller.js
const adminService = require('./admin.service');

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

// ===== THIS IS THE CORRECT CONTROLLER FUNCTION =====
const sendAdminNotification = async (req, res, next) => {
    try {
        // It takes the validated request body from the route...
        const result = await adminService.sendTargetedNotification(req.body);
        // ...and sends the result from the service back to the client.
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};
// ===================================================

module.exports = {
  getDashboardStats,
  getActivePaymentGateway,
  updateActivePaymentGateway,
  sendAdminNotification, // Export the new controller function
};