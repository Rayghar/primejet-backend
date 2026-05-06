// File: src/api/v2/fleet/fleet.routes.js
const express = require('express');
const auth = require('../../../middleware/auth.middleware');
const controller = require('./fleet.controller');

const router = express.Router();

router.get('/dashboard', auth(controller.readRoles), controller.getDashboard);
router.get('/mobile-inventory', auth(controller.readRoles), controller.getMobileInventory);
router.get('/trucks', auth(controller.readRoles), controller.listTrucks);
router.post('/trucks', auth(controller.manageRoles), controller.createTruck);
router.patch('/trucks/:truckId', auth(controller.manageRoles), controller.updateTruck);
router.get('/trips', auth(controller.readRoles), controller.listTrips);
router.post('/trips', auth(controller.manageRoles), controller.createTrip);
router.get('/trips/:tripId', auth(controller.readRoles), controller.getTrip);
router.patch('/trips/:tripId', auth(controller.manageRoles), controller.updateTrip);
router.patch('/trips/:tripId/status', auth(controller.manageRoles), controller.updateTripStatus);
router.post('/trips/:tripId/costs', auth(controller.manageRoles), controller.addTripCost);
router.post('/trips/:tripId/offloads', auth(controller.manageRoles), controller.addOffload);
router.post('/trips/:tripId/recalculate', auth(controller.manageRoles), controller.recalculateTrip);

module.exports = router;
