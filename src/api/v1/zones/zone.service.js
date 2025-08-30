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

  // <<-- MODIFIED: Update the service to handle new pricing fields -->>
  if (updateData.name) zone.name = updateData.name;
  if (typeof updateData.isActive === 'boolean') zone.isActive = updateData.isActive;
  if (updateData.outOfZoneMessage) zone.outOfZoneMessage = updateData.outOfZoneMessage;
  // Check if new fee values have been provided and update them
  if (typeof updateData.deliveryFee === 'number') {
    zone.deliveryFee = updateData.deliveryFee;
  }
  if (typeof updateData.expressSurcharge === 'number') {
    zone.expressSurcharge = updateData.expressSurcharge;
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