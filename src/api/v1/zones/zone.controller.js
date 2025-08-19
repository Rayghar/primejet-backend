// File: src/api/v1/zones/zone.controller.js
const zoneService = require('./zone.service');
const { logger } = require('../../../config/logger.config.js');

const createZone = async (req, res, next) => {
  try {
    logger.info('[ZONE_CONTROLLER] Received request to create new service zone.');
    logger.debug('[ZONE_CONTROLLER] Payload:', { body: req.body });
    const zone = await zoneService.createZone(req.body);
    logger.info(`[ZONE_CONTROLLER] Zone created successfully with ID: ${zone.id}`);
    res.status(201).json(zone);
  } catch (error) {
    logger.error('[ZONE_CONTROLLER] Error creating zone:', { message: error.message, stack: error.stack, payload: req.body });
    next(error);
  }
};

const getZones = async (req, res, next) => {
  try {
    logger.info('[ZONE_CONTROLLER] Fetching all service zones.');
    const zones = await zoneService.getZones();
    logger.info(`[ZONE_CONTROLLER] Successfully fetched ${zones.length} zones.`);
    res.status(200).json(zones);
  } catch (error) {
    logger.error('[ZONE_CONTROLLER] Error fetching zones:', { message: error.message, stack: error.stack });
    next(error);
  }
};

const updateZone = async (req, res, next) => {
  try {
    const { zoneId } = req.params;
    logger.info(`[ZONE_CONTROLLER] Updating service zone ID: ${zoneId}`);
    logger.debug('[ZONE_CONTROLLER] Update payload:', { body: req.body });
    const updatedZone = await zoneService.updateZone(zoneId, req.body);
    logger.info(`[ZONE_CONTROLLER] Zone ${zoneId} updated successfully.`);
    res.status(200).json(updatedZone);
  } catch (error) {
    logger.error(`[ZONE_CONTROLLER] Error updating zone ${req.params.zoneId}:`, { message: error.message, stack: error.stack, payload: req.body });
    next(error);
  }
};

const deleteZone = async (req, res, next) => {
  try {
    const { zoneId } = req.params;
    logger.info(`[ZONE_CONTROLLER] Deleting service zone ID: ${zoneId}`);
    const result = await zoneService.deleteZone(zoneId);
    logger.info(`[ZONE_CONTROLLER] Zone ${zoneId} deleted successfully.`);
    res.status(200).json(result);
  } catch (error) {
    logger.error(`[ZONE_CONTROLLER] Error deleting zone ${req.params.zoneId}:`, { message: error.message, stack: error.stack });
    next(error);
  }
};

module.exports = { createZone, getZones, updateZone, deleteZone };