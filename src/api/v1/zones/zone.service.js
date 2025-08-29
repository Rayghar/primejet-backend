// src/api/v1/zones/zone.service.js
const ServiceZone = require('../../../models/serviceZone.model');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');

const createZone = async (zoneData) => {
  logger.info('[ZONE_CREATE_START] Data: ' + JSON.stringify(zoneData));
  try {
    const newZone = new ServiceZone(zoneData);
    await newZone.save();
    logger.info('[ZONE_CREATE_SUCCESS] ID: ' + newZone.id);
    return newZone.toObject();
  } catch (error) {
    logger.error('[ZONE_CREATE_FAIL] Error: ' + error.message);
    throw error;
  }
};

const getZones = async () => {
  logger.info('[ZONE_FETCH_START]');
  try {
    const zones = await ServiceZone.find({}).sort({ state: 1, name: 1 });
    logger.info('[ZONE_FETCH_SUCCESS] Count: ' + zones.length);
    return zones;
  } catch (error) {
    logger.error('[ZONE_FETCH_FAIL] Error: ' + error.message);
    throw error;
  }
};

const updateZone = async (zoneId, updateData) => {
  logger.info('[ZONE_UPDATE_START] ID: ' + zoneId + ' Data: ' + JSON.stringify(updateData));
  try {
    const zone = await ServiceZone.findOne({ id: zoneId });
    if (!zone) {
      logger.warn('[ZONE_UPDATE_FAIL] Not found: ' + zoneId);
      throw new HttpError(404, 'Service zone not found.');
    }

    // Update informational fields if they are provided
    if (updateData.name) zone.name = updateData.name;
    if (typeof updateData.isActive === 'boolean') zone.isActive = updateData.isActive;
    if (updateData.outOfZoneMessage) zone.outOfZoneMessage = updateData.outOfZoneMessage;

    // --- This is the surgical fix ---
    // It ONLY targets the new fee fields and nothing else.
    if (typeof updateData.deliveryFee === 'number') {
      zone.deliveryFee = updateData.deliveryFee;
    }
    if (typeof updateData.expressSurcharge === 'number') {
      zone.expressSurcharge = updateData.expressSurcharge;
    }
    
    await zone.save();
    logger.info('[ZONE_UPDATE_SUCCESS] ID: ' + zoneId);
    return zone.toObject();
  } catch (error) {
    logger.error('[ZONE_UPDATE_FAIL] Error: ' + error.message);
    throw error;
  }
};

const deleteZone = async (zoneId) => {
  logger.info('[ZONE_DELETE_START] ID: ' + zoneId);
  try {
    const result = await ServiceZone.findOneAndDelete({ id: zoneId });
    if (!result) {
      logger.warn('[ZONE_DELETE_FAIL] Not found: ' + zoneId);
      throw new HttpError(404, 'Service zone not found.');
    }
    logger.info('[ZONE_DELETE_SUCCESS] ID: ' + zoneId);
    return { message: 'Service zone deleted successfully.' };
  } catch (error) {
    logger.error('[ZONE_DELETE_FAIL] Error: ' + error.message);
    throw error;
  }
};

module.exports = { createZone, getZones, updateZone, deleteZone };