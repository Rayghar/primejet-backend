// src/api/v2/logistics/logistics.routes.js
const express = require('express');
const logisticsController = require('./logistics.controller');
const authMiddleware = require('../../../middleware/auth.middleware');
const validate = require('../../../middleware/validate.middleware');
const { assignOrderToVanSchema } = require('./logistics.validation'); // Assuming validation schema exists

const router = express.Router();

/**
 * @route POST /api/v2/logistics/assign-order
 * @desc Assigns an unassigned order to an available van/driver.
 * @access Admin, Manager
 */
router.post(
    '/assign-order',
    authMiddleware(['admin', 'manager']),
    validate(assignOrderToVanSchema), // Validate request body
    logisticsController.assignOrderToVan
);

module.exports = router;