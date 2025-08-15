// src/api/v2/analytics/analytics.controller.js
const Order = require('../../../models/order.model');
const Run = require('../../../models/run.model');
const DailySummary = require('../../../models/dailySummary.model');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');
const mongoose = require('mongoose');

// --- NEW: Helper function to create a unified sales aggregation pipeline ---
const _getUnifiedSalesPipeline = () => {
    return [
        // Stage 1: Union with DailySummary
        {
            $unionWith: {
                coll: 'dailysummaries',
                pipeline: [
                    {
                        $match: {
                            status: 'approved',
                            'sales.totalRevenue': { $gt: 0 }
                        }
                    },
                    {
                        $project: {
                            _id: 0,
                            id: '$summaryId',
                            createdAt: '$date',
                            grandTotal: '$sales.totalRevenue',
                            items: [{
                                productName: 'LPG Gas',
                                quantity: '$sales.totalKgSold',
                                unitPrice: '$pricePerKg'
                            }],
                            paymentMethod: 'DailyLog',
                            branchId: '$branchId',
                            source: 'daily_log'
                        }
                    }
                ]
            }
        },
        // Stage 2: Match to filter out canceled orders and unapproved summaries
        {
            $match: {
                $or: [
                    { status: { $ne: 'Canceled by Customer' }, paymentStatus: 'Completed', source: { $exists: false } },
                    { source: 'daily_log' }
                ]
            }
        },
        // Stage 3: Normalize fields for consistency
        {
            $addFields: {
                grandTotal: { $ifNull: ['$grandTotal', 0] },
                totalKgSold: { $sum: '$items.quantity' }, // Re-calculate total kg sold from items array
                paymentMethod: {
                    $cond: {
                        if: { $eq: ['$source', 'daily_log'] },
                        then: 'DailyLog',
                        else: {
                            $cond: {
                                if: { $eq: ['$paymentMethod', 'card'] },
                                then: 'POS',
                                else: '$paymentMethod'
                            }
                        }
                    }
                },
                branchId: { $ifNull: ['$branchId', null] }
            }
        }
    ];
};

const getDashboardKpis = async (req, res, next) => {
  try {
    const pipeline = [
      ..._getUnifiedSalesPipeline(),
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$grandTotal' },
          totalKgSold: { $sum: '$totalKgSold' }
        }
      }
    ];

    const result = await Order.aggregate(pipeline);
    const { totalRevenue, totalKgSold } = result[0] || { totalRevenue: 0, totalKgSold: 0 };
    const activeDeliveries = await Run.countDocuments({ overallStatus: { $in: ['Assigned', 'In Progress'] } });
    const currentBulkStock = 8500; // Placeholder

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
    const pipeline = [
      ..._getUnifiedSalesPipeline(),
      {
        $group: {
          _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
          totalRevenue: { $sum: '$grandTotal' },
          totalKgSold: { $sum: '$totalKgSold' }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ];

    const salesData = await Order.aggregate(pipeline);
    res.status(200).json(salesData);
  } catch (error) {
    logger.error('Error fetching sales report:', error);
    next(new HttpError(500, 'Failed to fetch sales report data.'));
  }
};

const getSalesByPaymentMethod = async (req, res, next) => {
  try {
    const pipeline = [
      ..._getUnifiedSalesPipeline(),
      {
        $group: {
          _id: '$paymentMethod',
          totalRevenue: { $sum: '$grandTotal' },
          count: { $sum: 1 }
        }
      },
      { $sort: { totalRevenue: -1 } }
    ];
    const salesByMethod = await Order.aggregate(pipeline);
    res.status(200).json(salesByMethod);
  } catch (error) {
    logger.error('Error fetching sales by payment method:', error);
    next(new HttpError(500, 'Failed to fetch sales by payment method.'));
  }
};

const getSalesByBranch = async (req, res, next) => {
  try {
    const pipeline = [
      ..._getUnifiedSalesPipeline(),
      {
        $group: {
          _id: '$branchId',
          totalRevenue: { $sum: '$grandTotal' },
          count: { $sum: 1 }
        }
      },
      {
        $lookup: {
          from: 'plants',
          localField: '_id',
          foreignField: 'id',
          as: 'branchInfo'
        }
      },
      { $unwind: { path: '$branchInfo', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          branchId: '$_id',
          branchName: '$branchInfo.name',
          totalRevenue: 1,
          count: 1
        }
      },
      { $sort: { totalRevenue: -1 } }
    ];
    const salesByBranch = await Order.aggregate(pipeline);
    res.status(200).json(salesByBranch);
  } catch (error) {
    logger.error('Error fetching sales by branch:', error);
    next(new HttpError(500, 'Failed to fetch sales by branch.'));
  }
};

const getTopSellingProducts = async (req, res, next) => {
    try {
        const pipeline = [
            // Stage 1: Unify sales data
            ..._getUnifiedSalesPipeline(),
            // Stage 2: Deconstruct the items array
            { $unwind: '$items' },
            // Stage 3: Group by product name
            {
                $group: {
                    _id: '$items.productName',
                    totalQuantitySold: { $sum: '$items.quantity' },
                    totalRevenue: { $sum: { $multiply: ['$items.quantity', '$items.unitPrice'] } }
                }
            },
            // Stage 4: Sort and limit
            { $sort: { totalQuantitySold: -1 } },
            { $limit: 10 }
        ];
        const topProducts = await Order.aggregate(pipeline);
        res.status(200).json(topProducts);
    } catch (error) {
        logger.error('Error fetching top selling products:', error);
        next(new HttpError(500, 'Failed to fetch top selling products.'));
    }
};

module.exports = {
  getDashboardKpis,
  getSalesReport,
  getSalesByPaymentMethod,
  getSalesByBranch,
  getTopSellingProducts,
};