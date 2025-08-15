// src/api/v2/inventory/inventory.controller.js
const Asset = require('../../../models/asset.model');
const Loan = require('../../../models/loan.model');
const Cylinder = require('../../../models/cylinder.model');
const StockIn = require('../../../models/stockIn.model');
const Order = require('../../../models/order.model');
const DailySummary = require('../../../models/dailySummary.model'); // Import DailySummary
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');
const mongoose = require('mongoose');

/**
 * Fetches all assets.
 */
const getAssets = async (req, res, next) => {
  try {
    const assets = await Asset.find({});
    res.status(200).json(assets);
  } catch (error) {
    logger.error('Error fetching assets:', error);
    next(new HttpError(500, 'Failed to fetch assets.'));
  }
};

/**
 * Adds a new asset.
 */
const addAsset = async (req, res, next) => {
  try {
    const newAsset = new Asset(req.body);
    await newAsset.save();
    res.status(201).json(newAsset);
  } catch (error) {
    logger.error('Error adding asset:', error);
    next(new HttpError(500, 'Failed to add asset.'));
  }
};

/**
 * Fetches all loans.
 */
const getLoans = async (req, res, next) => {
  try {
    const loans = await Loan.find({});
    res.status(200).json(loans);
  } catch (error) {
    logger.error('Error fetching loans:', error);
    next(new HttpError(500, 'Failed to fetch loans.'));
  }
};

/**
 * Adds a new loan.
 */
const addLoan = async (req, res, next) => {
  try {
    const newLoan = new Loan(req.body);
    await newLoan.save();
    res.status(201).json(newLoan);
  } catch (error) {
    logger.error('Error adding loan:', error);
    next(new HttpError(500, 'Failed to add loan.'));
  }
};

/**
 * Deletes a loan by its ID.
 */
const deleteLoan = async (req, res, next) => {
  try {
    const { loanId } = req.params;
    const deleted = await Loan.findOneAndDelete({ id: loanId });
    if (!deleted) throw new HttpError(404, 'Loan not found.');
    res.status(200).json({ message: 'Loan deleted successfully.' });
  } catch (error) {
    logger.error('Error deleting loan:', error);
    next(error);
  }
};

/**
 * Adds a new cylinder.
 */
const addCylinder = async (req, res, next) => {
  try {
    const newCylinder = new Cylinder(req.body);
    await newCylinder.save();
    res.status(201).json(newCylinder);
  } catch (error) {
    logger.error('Error adding cylinder:', error);
    next(new HttpError(500, 'Failed to add cylinder.'));
  }
};

/**
 * Deletes a cylinder by its ID.
 */
const deleteCylinder = async (req, res, next) => {
  try {
    const { cylinderId } = req.params;
    const deleted = await Cylinder.findOneAndDelete({ id: cylinderId });
    if (!deleted) throw new HttpError(404, 'Cylinder batch not found.');
    res.status(200).json({ message: 'Cylinder batch deleted successfully.' });
  } catch (error) {
    logger.error('Error deleting cylinder:', error);
    next(error);
  }
};

/**
 * Logs a new stock-in (bulk LPG purchase) transaction.
 */
const addStockIn = async (req, res, next) => {
  try {
    const { quantityKg, supplier, purchaseDate, costPerKg, targetSalePricePerKg } = req.body;
    const loggedBy = { uid: req.user.id, email: req.user.email };

    const newStockIn = new StockIn({
      id: new mongoose.Types.ObjectId().toString(),
      quantityKg: parseFloat(quantityKg),
      supplier,
      purchaseDate: new Date(purchaseDate),
      costPerKg: parseFloat(costPerKg),
      targetSalePricePerKg: parseFloat(targetSalePricePerKg),
      remainingKg: parseFloat(quantityKg),
      loggedBy,
      createdAt: new Date(),
    });

    await newStockIn.save();
    logger.info(`New stock-in logged: ${quantityKg}kg from ${supplier} by ${req.user.email}`);

    res.status(201).json({ message: 'Stock-in logged successfully.', stockIn: newStockIn });
  } catch (error) {
    logger.error('Error adding stock-in:', error);
    if (error.name === 'ValidationError') {
      return next(new HttpError(400, error.message));
    }
    next(new HttpError(500, 'Failed to log stock-in.'));
  }
};

/**
 * Provides a comprehensive summary of inventory data, now with unified sales.
 */
const getInventorySummary = async (req, res, next) => {
  try {
    const totalStockedResult = await StockIn.aggregate([
      { $group: { _id: null, total: { $sum: '$quantityKg' } } }
    ]);
    const totalStocked = totalStockedResult[0]?.total || 0;

    // --- NEW: Calculate total sold from both Order and DailySummary models ---
    const totalSoldFromOrdersResult = await Order.aggregate([
      { $match: { status: 'Delivered' } },
      { $unwind: '$items' },
      { $group: { _id: null, total: { $sum: '$items.quantity' } } }
    ]);
    const totalSoldFromOrders = totalSoldFromOrdersResult[0]?.total || 0;

    const totalSoldFromSummariesResult = await DailySummary.aggregate([
        { $match: { status: 'approved' } },
        { $group: { _id: null, total: { $sum: '$sales.totalKgSold' } } }
    ]);
    const totalSoldFromSummaries = totalSoldFromSummariesResult[0]?.total || 0;
    const totalSold = totalSoldFromOrders + totalSoldFromSummaries;

    const currentBulkLpgKg = totalStocked - totalSold;
    
    const totalCylindersResult = await Cylinder.aggregate([
        { $group: { _id: null, total: { $sum: '$quantity' } } }
    ]);
    const totalCylinders = totalCylindersResult[0]?.total || 0;

    const lowStockThreshold = 1000;
    const lowStockAlert = currentBulkLpgKg < lowStockThreshold;

    res.status(200).json({
        currentBulkLpgKg: currentBulkLpgKg,
        totalCylinders: totalCylinders,
        lowStockAlert: lowStockAlert,
    });

  } catch (error) {
    logger.error('Error fetching inventory summary:', error);
    next(new HttpError(500, 'Failed to fetch inventory summary.'));
  }
};

/**
 * Fetches a history of LPG stock-in batches with unified profitability.
 */
const getLpgStockInHistory = async (req, res, next) => {
  try {
    const stockIns = await StockIn.find({}).sort({ purchaseDate: -1 });
    // --- NEW: Fetch sales data from both Order and DailySummary models ---
    const deliveredOrders = await Order.find({ status: 'Delivered' });
    const approvedSummaries = await DailySummary.find({ status: 'approved' });

    const historyWithProfitability = stockIns.map(stockBatch => {
        const batchObject = stockBatch.toObject();
        const expectedRevenue = batchObject.quantityKg * (batchObject.targetSalePricePerKg || 0);
        const totalCost = batchObject.quantityKg * (batchObject.costPerKg || 0);
        
        let actualRevenue = 0;
        let actualKgSold = 0;
        
        // Sum revenue and kgSold from orders after this batch's purchase date
        deliveredOrders.forEach(order => {
            if (order.orderDate >= batchObject.purchaseDate) {
                actualRevenue += order.grandTotal;
                actualKgSold += order.items.reduce((sum, item) => sum + (item.quantity || 0), 0);
            }
        });
        
        // Sum revenue and kgSold from approved daily summaries after this batch's purchase date
        approvedSummaries.forEach(summary => {
            if (summary.date >= batchObject.purchaseDate) {
                actualRevenue += summary.sales.totalRevenue;
                actualKgSold += summary.sales.totalKgSold;
            }
        });

        // Simplified calculation of estimated revenue and profit
        const estimatedActualRevenue = (actualRevenue / actualKgSold) * (batchObject.quantityKg - (batchObject.remainingKg || 0));
        const profitLoss = estimatedActualRevenue - totalCost;
        const profitMargin = totalCost > 0 ? (profitLoss / totalCost) * 100 : 0;
        const salesProgress = batchObject.quantityKg > 0 ? ((batchObject.quantityKg - batchObject.remainingKg) / batchObject.quantityKg) * 100 : 0;

        return {
            ...batchObject,
            expectedRevenue: expectedRevenue,
            totalCost: totalCost,
            estimatedActualRevenue: estimatedActualRevenue,
            profitLoss: profitLoss,
            profitMargin: parseFloat(profitMargin.toFixed(2)),
            salesProgress: parseFloat(salesProgress.toFixed(2)),
        };
    });

    res.status(200).json(historyWithProfitability);
  } catch (error) {
    logger.error('Error fetching LPG stock-in history:', error);
    next(new HttpError(500, 'Failed to retrieve LPG stock-in history.'));
  }
};

/**
 * Fetches all cylinders.
 */
const getCylinders = async (req, res, next) => {
  try {
    const cylinders = await Cylinder.find({});
    res.status(200).json(cylinders);
  } catch (error) {
    logger.error('Error fetching cylinders:', error);
    next(new HttpError(500, 'Failed to fetch cylinders.'));
  }
};

module.exports = {
  getAssets,
  addAsset,
  getLoans,
  addLoan,
  deleteLoan,
  getCylinders,
  addCylinder,
  deleteCylinder,
  addStockIn,
  getInventorySummary,
  getLpgStockInHistory,
};