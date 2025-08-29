const ServiceZone = require('../../../models/serviceZone.model');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');

const createZone = async (zoneData) => {
  logger.info('[ZONE_CREATE_START] Data: ' + JSON.stringify(zoneData));
  try {
    // --- FIX START: Transform standard coordinates to the custom DB format before saving ---
    if (zoneData.area && zoneData.area.coordinates) {
      const customCoordinates = zoneData.area.coordinates.map(linearRing => 
        linearRing.map(point => [
          { "$numberDouble": String(point[0]) },
          { "$numberDouble": String(point[1]) }
        ])
      );
      zoneData.area.coordinates = customCoordinates;
      logger.debug('[ZONE_CREATE_TRANSFORM] Converted coordinates to custom DB format.');
    }
    // --- FIX END ---

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
    // Use .lean() to get plain JS objects for easier manipulation
    const zones = await ServiceZone.find({}).sort({ state: 1, name: 1 }).lean();
    
    // --- FIX START: Transform the custom DB format back to standard GeoJSON for the client ---
    const standardizedZones = zones.map(zone => {
      if (zone.area && zone.area.coordinates) {
        const standardCoordinates = zone.area.coordinates.map(linearRing => 
          linearRing.map(point => {
            // Check if the point is in the custom object format
            if (Array.isArray(point) && point.length === 2 && point[0].hasOwnProperty('$numberDouble')) {
              return [
                parseFloat(point[0].$numberDouble),
                parseFloat(point[1].$numberDouble)
              ];
            }
            // Return point as-is if it's already in the correct format
            return point; 
          })
        );
        zone.area.coordinates = standardCoordinates;
      }
      return zone;
    });
    // --- FIX END ---

    logger.info('[ZONE_FETCH_SUCCESS] Count: ' + standardizedZones.length);
    return standardizedZones;
  } catch (error) {
    logger.error('[ZONE_FETCH_FAIL] Error: ' + error.message);
    throw error;
  }
};

// The updateZone function will likely need a similar transformation if you ever update the 'area' field.
// For now, it only updates non-geo fields, so it remains unchanged.
const updateZone = async (zoneId, updateData) => {
  logger.info('[ZONE_UPDATE_START] ID: ' + zoneId + ' Data: ' + JSON.stringify(updateData));
  try {
    const zone = await ServiceZone.findOne({ id: zoneId });
    if (!zone) {
      logger.warn('[ZONE_UPDATE_FAIL] Not found: ' + zoneId);
      throw new HttpError(404, 'Service zone not found.');
    }

    if (updateData.name) zone.name = updateData.name;
    if (typeof updateData.isActive === 'boolean') zone.isActive = updateData.isActive;
    if (updateData.outOfZoneMessage) zone.outOfZoneMessage = updateData.outOfZoneMessage;
    if (typeof updateData.deliveryFee === 'number') zone.deliveryFee = updateData.deliveryFee;
    if (typeof updateData.expressSurcharge === 'number') zone.expressSurcharge = updateData.expressSurcharge;
    
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