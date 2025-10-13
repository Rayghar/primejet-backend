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

const sendCustomNotification = async (req, res, next) => {
  try {
    const result = await adminService.sendCustomNotification(req.body);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};
module.exports = {
  getDashboardStats,
  getActivePaymentGateway,
  updateActivePaymentGateway,
  sendCustomNotification,
};