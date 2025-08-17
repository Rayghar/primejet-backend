// File: src/api/v1/zones/zone.controller.js
// << NEW FILE >>

const zoneService = require('./zone.service');

const createZone = async (req, res, next) => {
  try {
    const zone = await zoneService.createZone(req.body);
    res.status(201).json(zone);
  } catch (error) { next(error); }
};

const getZones = async (req, res, next) => {
  try {
    const zones = await zoneService.getZones();
    res.status(200).json(zones);
  } catch (error) { next(error); }
};

const updateZone = async (req, res, next) => {
  try {
    const updatedZone = await zoneService.updateZone(req.params.zoneId, req.body);
    res.status(200).json(updatedZone);
  } catch (error) { next(error); }
};

const deleteZone = async (req, res, next) => {
  try {
    const result = await zoneService.deleteZone(req.params.zoneId);
    res.status(200).json(result);
  } catch (error) { next(error); }
};

module.exports = { createZone, getZones, updateZone, deleteZone };