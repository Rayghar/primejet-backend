// File: src/api/v1/zones/zone.routes.js

const express = require('express');
const zoneController = require('./zone.controller');
const authMiddleware = require('../../../middleware/auth.middleware');

// << UNCOMMENT AND ADD THESE LINES >>
const validate = require('../../../middleware/validate.middleware');
const { createZoneSchema, updateZoneSchema } = require('./zone.validation');

const router = express.Router();

// All routes in this file are protected and require admin privileges
router.use(authMiddleware('admin'));

router.route('/')
  // Apply the createZoneSchema for POST requests
  .post(validate(createZoneSchema), zoneController.createZone)
  .get(zoneController.getZones);

router.route('/:zoneId')
  // Apply the updateZoneSchema for PUT requests
  .put(validate(updateZoneSchema), zoneController.updateZone)
  .delete(zoneController.deleteZone);

module.exports = router;