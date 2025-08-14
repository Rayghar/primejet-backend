// src/api/v1/reports/report.service.js
// Install with: npm install exceljs
const ExcelJS = require('exceljs'); // For Excel export
// const csv = require('csv-stringify'); // For CSV export if you prefer
const Order = require('../../../models/order.model'); // Example model
const User = require('../../../models/user.model'); // Example model
const WalletTransaction = require('../../../models/walletTransaction.model'); // <<< ADDED: Import WalletTransaction model
const HttpError = require('../../../utils/HttpError');
// const { logger } = require('../../../config/logger.config');

const generateReport = async ({ reportType, period, startDate, endDate }) => {
  let query = {};
  if (period !== 'allTime' && period !== 'custom') { // Adjusted condition to only calculate if not 'allTime' or 'custom'
    let _startDate = startDate;
    let _endDate = endDate;
    if (!startDate || !endDate) {
      const now = new Date();
      if (period === 'daily') {
        _startDate = new Date(now.setHours(0, 0, 0, 0));
        _endDate = new Date(now.setHours(23, 59, 59, 999));
      } else if (period === 'weekly') {
        _startDate = new Date(now.setDate(now.getDate() - now.getDay()));
        _endDate = new Date(now.setDate(now.getDate() + 6));
      } else if (period === 'monthly') {
        _startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        _endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      } else if (period === 'yearly') {
        _startDate = new Date(now.getFullYear(), 0, 1);
        _endDate = new Date(now.getFullYear(), 11, 31);
      }
    }
    if (_startDate) query.createdAt = { $gte: _startDate };
    if (_endDate) query.createdAt = { ...query.createdAt, $lte: _endDate };
  } else if (period === 'custom' && startDate && endDate) {
    query.createdAt = { $gte: startDate, $lte: endDate };
  }


  let data = {};
  switch (reportType) {
    // <<< START MODIFICATION HERE >>>
    case 'overview':
      // For overview, fetch data for all other relevant report types
      const salesOverview = await generateReport({ reportType: 'salesOverview', period, startDate, endDate });
      const orderStats = await generateReport({ reportType: 'orderStats', period, startDate, endDate });
      const customerStats = await generateReport({ reportType: 'customerStats', period, startDate, endDate });
      const driverStats = await generateReport({ reportType: 'driverStats', period, startDate, endDate });
      const transactionStats = await generateReport({ reportType: 'transactions', period, startDate, endDate }); // Fetch transactions summary for overview

      data = {
        salesOverview,
        orderStats,
        customerStats,
        driverStats,
        transactionStats,
      };
      break;
    // <<< END MODIFICATION HERE >>>
    case 'salesOverview':
      const totalRevenueResult = await Order.aggregate([
        { $match: { status: 'Delivered', ...query } },
        { $group: { _id: null, totalRevenue: { $sum: '$finalAmountPaid' } } }
      ]);
      data.totalRevenue = totalRevenueResult.length > 0 ? totalRevenueResult[0].totalRevenue / 100 : 0;
      data.totalOrders = await Order.countDocuments({ status: 'Delivered', ...query });
      // Example for revenue trend (requires more complex aggregation)
      data.revenueTrend = []; // Placeholder for actual data
      data.averageOrderValue = data.totalOrders > 0 ? data.totalRevenue / data.totalOrders : 0;
      break;
    case 'orderStats':
      data.totalOrders = await Order.countDocuments(query);
      data.deliveredOrders = await Order.countDocuments({ status: 'Delivered', ...query });
      data.cancelledOrders = await Order.countDocuments({ status: 'Cancelled', ...query });
      // Example for orders by status and popular cylinders (requires aggregation)
      data.ordersByStatus = {};
      data.popularCylinders = {};
      data.peakTimes = [];
      break;
    case 'customerStats':
      data.totalCustomers = await User.countDocuments({ role: 'customer', ...query });
      data.newRegistrations = await User.countDocuments({ role: 'customer', ...query, createdAt: query.createdAt }); // Simplified
      data.totalActiveCustomers = await User.countDocuments({ role: 'customer', status: 'active', ...query });
      data.topCustomers = []; // Placeholder for actual data
      break;
    case 'driverStats':
      data.totalDrivers = await User.countDocuments({ role: 'driver', ...query });
      data.totalActiveDrivers = await User.countDocuments({ role: 'driver', status: 'active', ...query });
      data.avgDeliveriesPerDriver = 0; // Placeholder
      data.avgDeliveryTimeMinutes = 0; // Placeholder
      data.topDrivers = []; // Placeholder
      break;
    case 'transactions':
      const transactionsData = await WalletTransaction.find(query).sort({ createdAt: 1 });
      data.transactions = transactionsData.map(tx => tx.toObject()); // Return full transaction objects for export
      // For summary in display:
      data.totalDeposits = transactionsData.filter(tx => tx.type.includes('DEPOSIT') || tx.type.includes('CREDIT') || tx.type.includes('BONUS')).reduce((sum, tx) => sum + tx.amount, 0) / 100;
      data.totalOrderPayments = transactionsData.filter(tx => tx.type === 'ORDER_PAYMENT').reduce((sum, tx) => sum + tx.amount, 0) / 100;
      data.totalTransactions = transactionsData.length;
      break;
    default:
      throw new HttpError(400, 'Invalid report type.');
  }
  return data;
}

// --- NEW SERVICE FUNCTION FOR EXPORT ---
const exportReport = async ({ reportType, startDate, endDate, format = 'xlsx' }) => {
  if (!startDate || !endDate) {
    throw new HttpError(400, 'Start date and end date are required for report export.');
  }

  const dataToExport = await generateReport({ reportType, period: 'custom', startDate, endDate });

  if (format === 'xlsx') {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(`${reportType} Report`);

    // Define columns based on reportType
    let columns = [];
    let rows = [];

    switch (reportType) {
      case 'salesOverview':
        // Example columns and data for sales
        columns = [{ header: 'Metric', key: 'metric' }, { header: 'Value', key: 'value' }];
        rows = [
          { metric: 'Total Revenue', value: dataToExport.totalRevenue },
          { metric: 'Total Orders', value: dataToExport.totalOrders },
        ];
        break;
      case 'orderStats':
        // Example columns and data for order stats
        columns = [{ header: 'Metric', key: 'metric' }, { header: 'Value', key: 'value' }];
        rows = [
          { metric: 'Total Orders', value: dataToExport.totalOrders },
          { metric: 'Delivered Orders', value: dataToExport.deliveredOrders },
          { metric: 'Cancelled Orders', value: dataToExport.cancelledOrders },
        ];
        break;
      case 'customerStats':
        // Example columns and data for customer stats
        columns = [{ header: 'Metric', key: 'metric' }, { header: 'Value', key: 'value' }];
        rows = [
          { metric: 'Total Customers', value: dataToExport.totalCustomers },
        ];
        break;
      case 'driverStats':
        // Example columns and data for driver stats
        columns = [{ header: 'Metric', key: 'metric' }, { header: 'Value', key: 'value' }];
        rows = [
          { metric: 'Total Drivers', value: dataToExport.totalDrivers },
          { metric: 'Online Drivers', value: dataToExport.onlineDrivers },
        ];
        break;
      case 'transactions':
        // Detailed transaction export
        columns = [
          { header: 'ID', key: 'id' },
          { header: 'User ID', key: 'userId' },
          { header: 'Type', key: 'type' },
          { header: 'Amount (NGN)', key: 'amount' },
          { header: 'Status', key: 'status' },
          { header: 'Description', key: 'description' },
          { header: 'Date', key: 'createdAt' },
          { header: 'Balance Before (NGN)', key: 'balanceBefore' },
          { header: 'Balance After (NGN)', key: 'balanceAfter' },
          { header: 'Order ID', key: 'orderId' },
          { header: 'Payment Gateway Ref', key: 'gatewayTransactionId' },
        ];
        rows = dataToExport.transactions.map(tx => ({
          id: tx.id,
          userId: tx.userId,
          type: tx.type,
          amount: tx.amount / 100, // Convert to Naira
          status: tx.status,
          description: tx.description,
          createdAt: tx.createdAt ? tx.createdAt.toISOString() : '',
          balanceBefore: tx.balanceBefore ? tx.balanceBefore / 100 : null,
          balanceAfter: tx.balanceAfter ? tx.balanceAfter / 100 : null,
          orderId: tx.orderId,
          gatewayTransactionId: tx.gatewayTransactionId,
        }));
        break;
      default:
        throw new HttpError(400, 'Unsupported report type for export.');
    }

    worksheet.columns = columns.map(col => ({ header: col.header, key: col.key, width: 20 }));
    worksheet.addRows(rows);

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;

  } else if (format === 'csv') {
    // CSV export logic (requires csv-stringify or manual string generation)
    throw new HttpError(501, 'CSV export not yet implemented.');
  }
};

module.exports = {
  generateReport,
  exportReport, // Export the new function
};