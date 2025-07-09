// File: src/api/v1/config/config.controller.js
const configService = require('./config.service');

// Handles GET /api/v1/config
const getSystemConfig = async (req, res, next) => {
  try {
    const config = await configService.getSystemConfig();
    res.status(200).json(config);
  } catch (error) {
    next(error);
  }
};

// Handles PUT /api/v1/config
const updateSystemConfig = async (req, res, next) => {
  try {
    const updatedConfig = await configService.updateSystemConfig(req.body);
    res.status(200).json({ message: 'System configuration updated successfully.', config: updatedConfig });
  } catch (error) {
    next(error);
  }
};

// Handles PATCH /api/v1/config/payment-gateway
const updatePaymentGateway = (req, res, next) => {
    try {
        const { gateway } = req.body;
        const result = configService.updateActiveGateway(gateway);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

module.exports = {
  getSystemConfig,
  updateSystemConfig,
  updatePaymentGateway,
};