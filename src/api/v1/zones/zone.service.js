const ServiceZone = require('../../../models/serviceZone.model');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');

const createZone = async (zoneData) => {
  // This function requires no changes. It will pass the validated data through.
  const newZone = new ServiceZone(zoneData);
  await newZone.save();
  return newZone.toObject();
};

const getZones = async () => {
  // This function requires no changes.
  const zones = await ServiceZone.find({}).sort({ state: 1, name: 1 }).lean();
  return zones;
};

const updateZone = async (zoneId, updateData) => {
  const zone = await ServiceZone.findOne({ id: zoneId });
  if (!zone) {
    throw new HttpError(404, 'Service zone not found.');
  }

  // Update standard fields if they exist
  if (updateData.name) zone.name = updateData.name;
  if (typeof updateData.isActive === 'boolean') zone.isActive = updateData.isActive;
  if (updateData.outOfZoneMessage) zone.outOfZoneMessage = updateData.outOfZoneMessage;
  if (typeof updateData.deliveryFee === 'number') zone.deliveryFee = updateData.deliveryFee;
  if (typeof updateData.expressSurcharge === 'number') zone.expressSurcharge = updateData.expressSurcharge;
  
  // <<-- NEW: Add the logic to update the price overrides -->>
  // This checks if a priceOverrides array was sent and updates it.
  if (Array.isArray(updateData.priceOverrides)) {
    zone.priceOverrides = updateData.priceOverrides;
  }

  await zone.save();
  return zone.toObject();
};

const deleteZone = async (zoneId) => {
  // This function requires no changes.
  const result = await ServiceZone.findOneAndDelete({ id: zoneId });
  if (!result) {
    throw new HttpError(404, 'Service zone not found.');
  }
  return { message: 'Service zone deleted successfully.' };
};

module.exports = { createZone, getZones, updateZone, deleteZone };