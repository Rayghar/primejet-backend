const express = require('express');
const zoneController = require('./zone.controller');
const authMiddleware = require('../../../middleware/auth.middleware');

// <<-- MODIFIED: Import and use the validation middleware -->>
const validate = require('../../../middleware/validate.middleware');
const { createZoneSchema, updateZoneSchema } = require('./zone.validation');

const router = express.Router();

router.use(authMiddleware('admin'));

router.route('/')
  // Apply validation when creating a zone
  .post(validate(createZoneSchema), zoneController.createZone)
  .get(zoneController.getZones);

router.route('/:zoneId')
  // Apply validation when updating a zone
  .put(validate(updateZoneSchema), zoneController.updateZone)
  .delete(zoneController.deleteZone);

module.exports = router;