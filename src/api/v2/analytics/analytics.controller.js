// src/api/v2/analytics/analytics.controller.js
const Order = require('../../../models/order.model');
const Run = require('../../../models/run.model');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');

const getDashboardKpis = async (req, res, next) => {
  try {
    // Calculate total revenue from completed orders
    const totalRevenueResult = await Order.aggregate([
      { $match: { paymentStatus: 'Completed' } },
      { $group: { _id: null, total: { $sum: '$grandTotal' } } }
    ]);
    const totalRevenue = totalRevenueResult[0]?.total || 0;

    // This would require a more complex aggregation to sum `items.quantity`
    const totalKgSoldResult = await Order.aggregate([
      { $match: { status: 'Delivered' } },
      { $unwind: '$items' },
      { $group: { _id: null, total: { $sum: '$items.quantity' } } }
    ]);
    const totalKgSold = totalKgSoldResult[0]?.total || 0;

    const activeDeliveries = await Run.countDocuments({ overallStatus: { $in: ['Assigned', 'In Progress'] } });

    // Placeholder for actual stock calculation
    const currentBulkStock = 8500; // This would come from a real service call

    res.status(200).json({
      totalRevenue,
      totalKgSold,
      currentBulkStock,
      activeDeliveries,
    });
  } catch (error) {
    logger.error('Error fetching dashboard KPIs:', error);
    next(new HttpError(500, 'Failed to fetch dashboard data.'));
  }
};

const getSalesReport = async (req, res, next) => {
  try {
    const salesData = await Order.aggregate([
      { $match: { paymentStatus: 'Completed', status: { $ne: 'Canceled by Customer' } } },
      { $group: {
        _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
        totalRevenue: { $sum: '$grandTotal' },
        totalKgSold: { $sum: { $sum: '$items.quantity' } }
      }},
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    res.status(200).json(salesData);
  } catch (error) {
    logger.error('Error fetching sales report:', error);
    next(new HttpError(500, 'Failed to fetch sales report data.'));
  }
};

/**
 * Aggregates sales data by payment method.
 */
const getSalesByPaymentMethod = async (req, res, next) => {
  try {
    const salesByMethod = await Order.aggregate([
      { $match: { paymentStatus: 'Completed', status: { $ne: 'Canceled by Customer' } } },
      { $group: {
        _id: '$paymentMethod',
        totalRevenue: { $sum: '$grandTotal' },
        count: { $sum: 1 }
      }},
      { $sort: { totalRevenue: -1 } }
    ]);
    res.status(200).json(salesByMethod);
  } catch (error) {
    logger.error('Error fetching sales by payment method:', error);
    next(new HttpError(500, 'Failed to fetch sales by payment method.'));
  }
};

/**
 * Aggregates sales data by branch.
 */
const getSalesByBranch = async (req, res, next) => {
  try {
    const salesByBranch = await Order.aggregate([
      { $match: { paymentStatus: 'Completed', status: { $ne: 'Canceled by Customer' }, branchId: { $exists: true, $ne: null } } },
      { $group: {
        _id: '$branchId',
        totalRevenue: { $sum: '$grandTotal' },
        count: { $sum: 1 }
      }},
      { $lookup: { // Join with plants collection to get branch names
          from: 'plants', // The name of the collection in MongoDB
          localField: '_id',
          foreignField: 'id',
          as: 'branchInfo'
      }},
      { $unwind: { path: '$branchInfo', preserveNullAndEmptyArrays: true } }, // Unwind to deconstruct the array
      { $project: { // Project to reshape the output
          _id: 0, // Exclude default _id
          branchId: '$_id',
          branchName: '$branchInfo.name',
          totalRevenue: 1,
          count: 1
      }},
      { $sort: { totalRevenue: -1 } }
    ]);
    res.status(200).json(salesByBranch);
  } catch (error) {
    logger.error('Error fetching sales by branch:', error);
    next(new HttpError(500, 'Failed to fetch sales by branch.'));
  }
};

/**
 * Aggregates top-selling products (by quantity).
 */
const getTopSellingProducts = async (req, res, next) => {
  try {
    const topProducts = await Order.aggregate([
      { $match: { paymentStatus: 'Completed', status: { $ne: 'Canceled by Customer' } } },
      { $unwind: '$items' }, // Deconstruct the items array
      { $group: {
        _id: '$items.productName',
        totalQuantitySold: { $sum: '$items.quantity' },
        totalRevenue: { $sum: '$items.quantity' * '$items.unitPrice' } // Calculate revenue per product
      }},
      { $sort: { totalQuantitySold: -1 } },
      { $limit: 10 } // Limit to top 10 products
    ]);
    res.status(200).json(topProducts);
  } catch (error) {
    logger.error('Error fetching top selling products:', error);
    next(new HttpError(500, 'Failed to fetch top selling products.'));
  }
};

module.exports = {
  getDashboardKpis,
  getSalesReport,
  getSalesByPaymentMethod, // Export new functions
  getSalesByBranch,
  getTopSellingProducts,
};