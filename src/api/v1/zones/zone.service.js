// File: src/api/v1/zones/zone.service.js
// << NEW FILE >>

const ServiceZone = require('../../../models/serviceZone.model');
const HttpError = require('../../../utils/HttpError');

const createZone = async (zoneData) => {
  const newZone = new ServiceZone(zoneData);
  await newZone.save();
  return newZone.toObject();
};

const getZones = async () => {
  return await ServiceZone.find({}).sort({ state: 1, name: 1 });
};

const updateZone = async (zoneId, updateData) => {
  const { name, isActive, outOfZoneMessage } = updateData;
  const zone = await ServiceZone.findOne({ id: zoneId });
  if (!zone) {
    throw new HttpError(404, 'Service zone not found.');
  }

  if (name) zone.name = name;
  if (typeof isActive === 'boolean') zone.isActive = isActive;
  if (outOfZoneMessage) zone.outOfZoneMessage = outOfZoneMessage;

  await zone.save();
  return zone.toObject();
};

const deleteZone = async (zoneId) => {
  const result = await ServiceZone.findOneAndDelete({ id: zoneId });
  if (!result) {
    throw new HttpError(404, 'Service zone not found.');
  }
  return { message: 'Service zone deleted successfully.' };
};

module.exports = { createZone, getZones, updateZone, deleteZone };