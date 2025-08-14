// src/api/v2/operations/operations.controller.js
const Plant = require('../../../models/plant.model');
const Van = require('../../../models/van.model');
const MaintenanceLog = require('../../../models/maintenanceLog.model');
const DailySummary = require('../../../models/dailySummary.model');
const Order = require('../../../models/order.model');       // ADD THIS IMPORT
const DataEntry = require('../../../models/dataEntry.model'); // ADD THIS IMPORT
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');
const mongoose = require('mongoose');

/**
 * Fetches the status of all plants, enhanced with profitability metrics.
 */
const getPlants = async (req, res, next) => {
  try {
    const plants = await Plant.find({});

    const plantsWithMetrics = await Promise.all(plants.map(async (plant) => {
        const plantObject = plant.toObject();

        // Calculate total revenue for this plant for a recent period (e.g., last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const plantRevenueResult = await Order.aggregate([
            { $match: { 
                branchId: plant.id, 
                status: 'Delivered', 
                orderDate: { $gte: thirtyDaysAgo } 
            }},
            { $group: { _id: null, totalRevenue: { $sum: '$grandTotal' } }}
        ]);
        const totalPlantRevenue = plantRevenueResult[0]?.totalRevenue || 0;

        // Calculate total expenses for this plant for a recent period (e.g., last 30 days)
        const plantExpensesResult = await DataEntry.aggregate([
            { $match: { 
                branchId: plant.id, 
                type: 'expense', 
                status: 'approved', 
                date: { $gte: thirtyDaysAgo } 
            }},
            { $group: { _id: null, totalExpenses: { $sum: '$amount' } }}
        ]);
        const totalPlantExpenses = plantExpensesResult[0]?.totalExpenses || 0;

        const plantProfitability = totalPlantRevenue - totalPlantExpenses;
        const expensesAsPercentageOfRevenue = totalPlantRevenue > 0 ? (totalPlantExpenses / totalPlantRevenue) * 100 : 0;

        return {
            ...plantObject,
            totalPlantRevenue: totalPlantRevenue,
            totalPlantExpenses: totalPlantExpenses,
            plantProfitability: plantProfitability,
            expensesAsPercentageOfRevenue: parseFloat(expensesAsPercentageOfRevenue.toFixed(2)),
        };
    }));

    res.status(200).json(plantsWithMetrics);
  } catch (error) {
    logger.error('Error fetching plant data with metrics:', error);
    next(new HttpError(500, 'Failed to fetch plant data.'));
  }
};

/**
 * Adds a new plant to the database.
 */
const addPlant = async (req, res, next) => {
  try {
    const { name, capacity, status, uptime, outputToday, monthlyOpex, location, targetDailyOutputKg, lastMaintenanceDate, nextMaintenanceDate } = req.body;
    
    const newPlant = new Plant({
      id: new mongoose.Types.ObjectId().toString(),
      name,
      capacity: parseFloat(capacity),
      status,
      uptime: parseFloat(uptime) || 100,
      outputToday: parseFloat(outputToday) || 0,
      monthlyOpex: parseFloat(monthlyOpex) || 0,
      location,
      targetDailyOutputKg: parseFloat(targetDailyOutputKg) || 0,
      lastMaintenanceDate: lastMaintenanceDate ? new Date(lastMaintenanceDate) : undefined,
      nextMaintenanceDate: nextMaintenanceDate ? new Date(nextMaintenanceDate) : undefined,
    });

    await newPlant.save();
    logger.info(`New plant added: ${name} with capacity ${capacity}kg.`);
    res.status(201).json(newPlant);
  } catch (error) {
    logger.error('Error adding plant:', error);
    if (error.name === 'ValidationError') {
      return next(new HttpError(400, error.message));
    }
    next(new HttpError(500, 'Failed to add plant.'));
  }
};

/**
 * Deletes a plant by its ID.
 */
const deletePlant = async (req, res, next) => {
  try {
    const { plantId } = req.params;
    const deletedPlant = await Plant.findOneAndDelete({ id: plantId });
    if (!deletedPlant) {
      throw new HttpError(404, 'Plant not found.');
    }
    logger.info(`Plant ${plantId} deleted successfully.`);
    res.status(200).json({ message: 'Plant deleted successfully.' });
  } catch (error) {
    logger.error(`Error deleting plant ${req.params.plantId}:`, error);
    next(error);
  }
};

/**
 * Fetches data for all vans.
 */
const getVans = async (req, res, next) => {
  try {
    const vans = await Van.find({});
    res.status(200).json(vans);
  } catch (error) {
    logger.error('Error fetching vans data:', error);
    next(new HttpError(500, 'Failed to fetch vans data.'));
  }
};

/**
 * Adds a new maintenance log for a specific plant.
 */
const addMaintenanceLog = async (req, res, next) => {
  try {
    const { plantId } = req.params;
    const { type, description, startDate, endDate, cost, performedBy, status } = req.body;

    const newLog = new MaintenanceLog({
      id: new mongoose.Types.ObjectId().toString(),
      plantId,
      type,
      description,
      startDate: new Date(startDate),
      endDate: endDate ? new Date(endDate) : undefined,
      cost: parseFloat(cost) || 0,
      performedBy,
      status,
    });

    await newLog.save();

    await Plant.findOneAndUpdate(
      { id: plantId },
      { $set: { lastMaintenanceDate: new Date(startDate) } },
      { new: true }
    );

    logger.info(`Maintenance log added for plant ${plantId}: ${description}`);
    res.status(201).json(newLog);
  } catch (error) {
    logger.error('Error adding maintenance log:', error);
    next(new HttpError(500, 'Failed to add maintenance log.'));
  }
};

/**
 * Fetches maintenance logs for a specific plant.
 */
const getMaintenanceLogs = async (req, res, next) => {
  try {
    const { plantId } = req.params;
    const logs = await MaintenanceLog.find({ plantId }).sort({ startDate: -1 });
    res.status(200).json(logs);
  } catch (error) {
    logger.error(`Error fetching maintenance logs for plant ${plantId}:`, error);
    next(new HttpError(500, 'Failed to retrieve maintenance logs.'));
  }
};

/**
 * Fetches daily output history for a specific plant for the last N days.
 */
const getPlantDailyOutputHistory = async (req, res, next) => {
  try {
    const { plantId } = req.params;
    const days = parseInt(req.query.days) || 7;

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const history = await DailySummary.aggregate([
      {
        $match: {
          branchId: plantId,
          status: 'approved',
          date: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $project: {
          _id: 0,
          date: { $dateToString: { format: "%Y-%m-%d", date: "$date" } },
          totalKgSold: {
            $add: [
              { $subtract: ["$meters.closingMeterA", "$meters.openingMeterA"] },
              { $subtract: ["$meters.closingMeterB", "$meters.openingMeterB"] }
            ]
          }
        }
      },
      { $sort: { date: 1 } }
    ]);

    res.status(200).json(history);
  } catch (error) {
    logger.error(`Error fetching daily output history for plant ${plantId}:`, error);
    next(new HttpError(500, 'Failed to retrieve plant daily output history.'));
  }
};


module.exports = {
  getPlants,
  addPlant,
  deletePlant,
  getVans,
  addMaintenanceLog,
  getMaintenanceLogs,
  getPlantDailyOutputHistory,
};