// File: src/api/v1/zones/zone.routes.js
// << NEW FILE >>

const express = require('express');
const zoneController = require('./zone.controller');
const authMiddleware = require('../../../middleware/auth.middleware');
// Assuming you have a validation middleware and schemas, otherwise remove `validate`
// const validate = require('../../../middleware/validate.middleware');
// const { createZoneSchema, updateZoneSchema } = require('./zone.validation');

const router = express.Router();

// All routes in this file are protected and require admin privileges
router.use(authMiddleware('admin'));

router.route('/')
  .post(zoneController.createZone)
  .get(zoneController.getZones);

router.route('/:zoneId')
  .put(zoneController.updateZone)
  .delete(zoneController.deleteZone);

module.exports = router;