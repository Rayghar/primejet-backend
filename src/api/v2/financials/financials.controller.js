// src/api/v2/financials/financials.controller.js

const Order = require('../../../models/order.model');
const Asset = require('../../../models/asset.model');
const Loan = require('../../../models/loan.model');
const Config = require('../../../models/config.model');
const DataEntry = require('../../../models/dataEntry.model'); // For expenses
const StockIn = require('../../../models/stockIn.model');     // For inventory calculation
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');

/**
 * @desc Generates comprehensive financial statements (Income, Balance Sheet, Cash Flow).
 * Calculates all metrics server-side based on approved sales, expenses, assets, and loans.
 * @route GET /api/v2/financials/statements
 * @access Admin, Finance Lead
 * @param {object} req - Express request object.
 * @param {object} req.query.branchId - Optional branch ID to filter data.
 * @param {object} res - Express response object.
 * @param {function} next - Express next middleware function.
 */
const getFinancialStatements = async (req, res, next) => {
  try {
    const { branchId } = req.query; // Get branchId from query parameters

    // Build match query for orders and expenses based on branchId
    const branchMatchQuery = {};
    if (branchId && branchId !== 'all') {
      branchMatchQuery.branchId = branchId;
    }

    // Fetch necessary data from MongoDB
    const orders = await Order.find({ 
        paymentStatus: 'Completed', 
        status: 'Delivered',
        ...branchMatchQuery // Apply branch filter to orders
    });
    const expenses = await DataEntry.find({
        type: 'expense',
        status: 'approved', // Only approved expenses
        ...branchMatchQuery // Apply branch filter to expenses
    });
    const assets = await Asset.find({});
    const loans = await Loan.find({});
    const config = await Config.findOne({}); // Fetch global config for shareCapital and VAT
    const stockIns = await StockIn.find({}); // Fetch stock-in records for inventory calculation

    // --- Income Statement Calculations ---
    const monthlyTotals = {};
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const COGS_MARGIN = 0.773; // Cost of Goods Sold margin (from your original code)

    // Aggregate sales revenue by month
    orders.forEach(order => {
      const date = order.orderDate;
      if (!date) return;
      const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
      if (!monthlyTotals[monthKey]) {
        monthlyTotals[monthKey] = { label: `${monthNames[date.getMonth()]} '${String(date.getFullYear()).slice(2)}`, year: date.getFullYear(), month: date.getMonth(), revenue: 0, opCosts: 0 };
      }
      monthlyTotals[monthKey].revenue += order.grandTotal;
    });

    // Aggregate operational expenses by month
    expenses.forEach(expense => {
        const date = expense.date;
        if (!date) return;
        const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
        if (!monthlyTotals[monthKey]) {
            monthlyTotals[monthKey] = { label: `${monthNames[date.getMonth()]} '${String(date.getFullYear()).slice(2)}`, year: date.getFullYear(), month: date.getMonth(), revenue: 0, opCosts: 0 };
        }
        monthlyTotals[monthKey].opCosts += expense.amount;
    });

    const incomeData = Object.values(monthlyTotals).map(month => {
      const cogs = month.revenue * COGS_MARGIN;
      const grossProfit = month.revenue - cogs;
      const netProfit = grossProfit - month.opCosts;
      return { ...month, cogs, grossProfit, netProfit };
    }).sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);

    const incomeTotals = incomeData.reduce((acc, month) => {
      acc.revenue += month.revenue; acc.cogs += month.cogs; acc.grossProfit += month.grossProfit;
      acc.opCosts += month.opCosts; acc.netProfit += month.netProfit;
      return acc;
    }, { revenue: 0, cogs: 0, grossProfit: 0, opCosts: 0, netProfit: 0 });

    // --- Balance Sheet Calculations ---
    const grossFixedAssets = assets.reduce((sum, asset) => sum + asset.cost, 0);
    const totalDepreciation = grossFixedAssets * 0.10; // Simplified 10% annual depreciation
    const netFixedAssets = grossFixedAssets - totalDepreciation;
    const totalLoans = loans.reduce((sum, loan) => sum + loan.principal, 0);

    const shareCapital = config?.financialSettings?.shareCapital || 20000000; // Get from config, fallback to default
    const retainedEarnings = incomeTotals.netProfit; // Simplified: assumes all profit is retained
    const totalEquity = shareCapital + retainedEarnings;

    // Dynamic Inventory Value Calculation:
    const totalKgStocked = stockIns.reduce((sum, si) => sum + (si.quantityKg || 0), 0);
    const totalKgSold = orders.reduce((sum, order) => sum + order.items.reduce((itemSum, item) => itemSum + (item.quantity || 0), 0), 0);
    const remainingKg = totalKgStocked - totalKgSold;

    // Calculate average cost per kg from stock-ins for inventory valuation
    const totalCostOfStockedLPG = stockIns.reduce((sum, si) => sum + (si.quantityKg * si.costPerKg), 0);
    const averageCostPerKg = totalKgStocked > 0 ? totalCostOfStockedLPG / totalKgStocked : 850; // Fallback depot price

    const currentInventoryValue = remainingKg * averageCostPerKg;

    // --- Cash Flow Statement Calculations ---
    const cashFromFinancing = totalLoans + shareCapital;
    const cashForInvesting = grossFixedAssets; // Assuming all fixed assets are investments
    const cashFromOps = incomeTotals.netProfit + totalDepreciation; // Add back non-cash depreciation

    const netCashFlow = cashFromOps - cashForInvesting + cashFromFinancing;

    const balanceSheet = {
      assets: { 
        current: { cash: netCashFlow, inventory: currentInventoryValue, total: netCashFlow + currentInventoryValue }, 
        fixed: { gross: grossFixedAssets, depreciation: totalDepreciation, net: netFixedAssets }, 
        total: netCashFlow + currentInventoryValue + netFixedAssets 
      },
      liabilities: { loans: totalLoans, total: totalLoans },
      equity: { shareCapital, retainedEarnings, total: totalEquity },
      totalLiabilitiesAndEquity: totalLoans + totalEquity,
    };

    const cashFlow = { 
      operating: cashFromOps, 
      investing: cashForInvesting, 
      financing: cashFromFinancing, 
      netCashFlow: netCashFlow 
    };

    res.status(200).json({
      incomeData,
      incomeTotals,
      balanceSheet,
      cashFlow,
    });
  } catch (error) {
    logger.error('Error generating financial statements:', error);
    next(new HttpError(500, 'Failed to generate financial statements.'));
  }
};

/**
 * @desc Generates a revenue assurance report by comparing expected vs. actual revenue from stock batches.
 * Performs all calculations server-side.
 * @route GET /api/v2/financials/revenue-assurance
 * @access Admin, Finance Lead
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 * @param {function} next - Express next middleware function.
 */
const getRevenueAssuranceReport = async (req, res, next) => {
  try {
    const stockIns = await StockIn.find({}); // Fetch all stock-in batches
    const orders = await Order.find({ paymentStatus: 'Completed', status: 'Delivered' }); // Fetch all delivered sales

    const report = stockIns.map(batch => {
      const expectedRevenue = batch.quantityKg * (batch.targetSalePricePerKg || 0);

      // Calculate actual revenue and progress based on remainingKg
      const actualKgSoldFromBatch = batch.quantityKg - (batch.remainingKg || 0);
      const actualRevenue = actualKgSoldFromBatch * (batch.targetSalePricePerKg || 0); // Assuming target price for actual revenue

      const progress = batch.quantityKg > 0 ? (actualKgSoldFromBatch / batch.quantityKg) * 100 : 0;
      
      const deviation = expectedRevenue > 0 ? ((actualRevenue - expectedRevenue) / expectedRevenue) * 100 : 0;

      return {
        id: batch.id,
        purchaseDate: batch.purchaseDate,
        quantityKg: batch.quantityKg,
        expectedRevenue: expectedRevenue,
        actualRevenue: actualRevenue,
        deviation: deviation,
        progress: Math.min(100, Math.max(0, progress)), // Cap progress between 0 and 100
      };
    });

    res.status(200).json(report);
  } catch (error) {
    logger.error('Error generating revenue assurance report:', error);
    next(new HttpError(500, 'Failed to generate revenue assurance report.'));
  }
};

/**
 * @desc Generates a tax compliance report (primarily VAT).
 * Performs all calculations server-side.
 * @route GET /api/v2/financials/tax-compliance
 * @access Admin, Finance Lead
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 * @param {function} next - Express next middleware function.
 */
const getTaxComplianceReport = async (req, res, next) => {
  try {
    const orders = await Order.find({ paymentStatus: 'Completed', status: 'Delivered' });
    const expenses = await DataEntry.find({ type: 'expense', status: 'approved' });
    const config = await Config.findOne({}); // Fetch global config for tax rates

    const totalRevenue = orders.reduce((sum, order) => sum + (order.grandTotal || 0), 0);
    const totalExpenses = expenses.reduce((sum, expense) => sum + (expense.amount || 0), 0);

    const VAT_RATE = config?.feeSettings?.vatPercentage / 100 || 0.075; // Use configured VAT rate, fallback to 7.5%
    const vatPayable = totalRevenue * VAT_RATE;

    res.status(200).json({
      totalRevenue,
      totalExpenses,
      vatPayable,
      vatRate: VAT_RATE * 100, // Return as percentage
    });
  } catch (error) {
    logger.error('Error generating tax compliance report:', error);
    next(new HttpError(500, 'Failed to generate tax compliance report.'));
  }
};

module.exports = {
  getFinancialStatements,
  getRevenueAssuranceReport,
  getTaxComplianceReport
};