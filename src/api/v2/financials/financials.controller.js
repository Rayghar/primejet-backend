// src/api/v2/financials/financials.controller.js
const Order = require('../../../models/order.model');
const Asset = require('../../../models/asset.model');
const Loan = require('../../../models/loan.model');
const Config = require('../../../models/config.model');
const ExpenseTransaction = require('../../../models/expenseTransaction.model'); // Import the correct Expense model
const DailySummary = require('../../../models/dailySummary.model');
const StockIn = require('../../../models/stockIn.model');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');

const getFinancialStatements = async (req, res, next) => {
  try {
    const { branchId } = req.query;
    const branchMatchQuery = {};
    if (branchId && branchId !== 'all') {
      branchMatchQuery.branchId = branchId;
    }

    // --- NEW: Fetch data from all relevant sources ---
    const orders = await Order.find({
        paymentStatus: 'Completed',
        status: 'Delivered',
        ...branchMatchQuery
    }).lean(); // Use .lean() for faster aggregation
    const dailySummaries = await DailySummary.find({
        status: 'approved',
        ...branchMatchQuery
    }).lean();
    const expenses = await ExpenseTransaction.find({
        ...branchMatchQuery
    }).lean();
    const assets = await Asset.find({});
    const loans = await Loan.find({});
    const config = await Config.findOne({});
    const stockIns = await StockIn.find({});

    // --- Income Statement Calculations ---
    const monthlyTotals = {};
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const COGS_MARGIN = 0.773;

    // Aggregate revenue and expenses from Orders
    orders.forEach(order => {
        const date = order.orderDate;
        if (!date) return;
        const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
        if (!monthlyTotals[monthKey]) {
            monthlyTotals[monthKey] = { label: `${monthNames[date.getMonth()]} '${String(date.getFullYear()).slice(2)}`, year: date.getFullYear(), month: date.getMonth(), revenue: 0, opCosts: 0 };
        }
        monthlyTotals[monthKey].revenue += order.grandTotal;
    });

    // Aggregate revenue and expenses from approved DailySummaries
    dailySummaries.forEach(summary => {
        const date = summary.date;
        if (!date) return;
        const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
        if (!monthlyTotals[monthKey]) {
            monthlyTotals[monthKey] = { label: `${monthNames[date.getMonth()]} '${String(date.getFullYear()).slice(2)}`, year: date.getFullYear(), month: date.getMonth(), revenue: 0, opCosts: 0 };
        }
        monthlyTotals[monthKey].revenue += summary.sales.totalRevenue || 0;
        monthlyTotals[monthKey].opCosts += summary.expenses.total || 0;
    });

    // Also include individual expense transactions not linked to a summary (if any)
    expenses.forEach(expense => {
        if (expense.dailySummaryId) return; // Skip if it's already part of a summary
        const date = expense.createdAt; // Assuming expenses have a createdAt date
        if (!date) return;
        const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
        if (!monthlyTotals[monthKey]) {
            monthlyTotals[monthKey] = { label: `${monthNames[date.getMonth()]} '${String(date.getFullYear()).slice(2)}`, year: date.getFullYear(), month: date.getMonth(), revenue: 0, opCosts: 0 };
        }
        monthlyTotals[monthKey].opCosts += expense.amount || 0;
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
    const totalDepreciation = grossFixedAssets * 0.10;
    const netFixedAssets = grossFixedAssets - totalDepreciation;
    const totalLoans = loans.reduce((sum, loan) => sum + loan.principal, 0);

    const shareCapital = config?.financialSettings?.shareCapital || 20000000;
    const retainedEarnings = incomeTotals.netProfit;
    const totalEquity = shareCapital + retainedEarnings;

    // --- NEW: Calculate total kg sold from both sources ---
    const totalKgSoldFromOrders = orders.reduce((sum, order) => sum + order.items.reduce((itemSum, item) => itemSum + (item.quantity || 0), 0), 0);
    const totalKgSoldFromSummaries = dailySummaries.reduce((sum, summary) => sum + (summary.sales.totalKgSold || 0), 0);
    const totalKgSold = totalKgSoldFromOrders + totalKgSoldFromSummaries;

    const totalKgStocked = stockIns.reduce((sum, si) => sum + (si.quantityKg || 0), 0);
    const remainingKg = totalKgStocked - totalKgSold;

    const totalCostOfStockedLPG = stockIns.reduce((sum, si) => sum + (si.quantityKg * si.costPerKg), 0);
    const averageCostPerKg = totalKgStocked > 0 ? totalCostOfStockedLPG / totalKgStocked : 850;
    const currentInventoryValue = remainingKg * averageCostPerKg;

    // --- Cash Flow Statement Calculations ---
    const cashFromFinancing = totalLoans + shareCapital;
    const cashForInvesting = grossFixedAssets;
    const cashFromOps = incomeTotals.netProfit + totalDepreciation;
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

const getRevenueAssuranceReport = async (req, res, next) => {
  try {
    const stockIns = await StockIn.find({});
    // --- NEW: Fetch sales data from both Order and DailySummary models ---
    const orders = await Order.find({ paymentStatus: 'Completed', status: 'Delivered' });
    const dailySummaries = await DailySummary.find({ status: 'approved' });

    const report = stockIns.map(batch => {
      const expectedRevenue = batch.quantityKg * (batch.targetSalePricePerKg || 0);
      const totalCost = batch.quantityKg * (batch.costPerKg || 0);
      
      let actualKgSold = 0;
      let actualRevenue = 0;
      
      // Calculate actual kg sold from Orders
      orders.forEach(order => {
        if (order.orderDate >= batch.purchaseDate) {
          actualKgSold += order.items.reduce((sum, item) => sum + (item.quantity || 0), 0);
          actualRevenue += order.grandTotal || 0;
        }
      });
      
      // Calculate actual kg sold from DailySummaries
      dailySummaries.forEach(summary => {
        if (summary.date >= batch.purchaseDate) {
          actualKgSold += summary.sales.totalKgSold || 0;
          actualRevenue += summary.sales.totalRevenue || 0;
        }
      });

      const profitLoss = actualRevenue - totalCost;
      const profitMargin = totalCost > 0 ? (profitLoss / totalCost) * 100 : 0;
      const salesProgress = batch.quantityKg > 0 ? (actualKgSold / batch.quantityKg) * 100 : 0;

      const deviation = expectedRevenue > 0 ? ((actualRevenue - expectedRevenue) / expectedRevenue) * 100 : 0;


      return {
        id: batch.id,
        purchaseDate: batch.purchaseDate,
        quantityKg: batch.quantityKg,
        expectedRevenue: expectedRevenue,
        actualRevenue: actualRevenue,
        deviation: deviation,
        progress: Math.min(100, Math.max(0, salesProgress)),
      };
    });

    res.status(200).json(report);
  } catch (error) {
    logger.error('Error generating revenue assurance report:', error);
    next(new HttpError(500, 'Failed to generate revenue assurance report.'));
  }
};


const getTaxComplianceReport = async (req, res, next) => {
  try {
    // --- NEW: Fetch sales data from both Order and DailySummary models ---
    const orders = await Order.find({ paymentStatus: 'Completed', status: 'Delivered' });
    const dailySummaries = await DailySummary.find({ status: 'approved' });
    const expenses = await ExpenseTransaction.find({ status: 'approved' });
    const config = await Config.findOne({});

    // Calculate total revenue from both sources
    const totalRevenueFromOrders = orders.reduce((sum, order) => sum + (order.grandTotal || 0), 0);
    const totalRevenueFromSummaries = dailySummaries.reduce((sum, summary) => sum + (summary.sales.totalRevenue || 0), 0);
    const totalRevenue = totalRevenueFromOrders + totalRevenueFromSummaries;

    // Calculate total expenses from both sources
    const totalExpensesFromExpenses = expenses.reduce((sum, expense) => sum + (expense.amount || 0), 0);
    const totalExpensesFromSummaries = dailySummaries.reduce((sum, summary) => sum + (summary.expenses.total || 0), 0);
    const totalExpenses = totalExpensesFromExpenses + totalExpensesFromSummaries;

    const VAT_RATE = config?.feeSettings?.vatPercentage / 100 || 0.075;
    const vatPayable = totalRevenue * VAT_RATE;

    res.status(200).json({
      totalRevenue,
      totalExpenses,
      vatPayable,
      vatRate: VAT_RATE * 100,
    });
  } catch (error) {
    logger.error('Error generating tax compliance report:', error);
    next(new HttpError(500, 'Failed to generate tax compliance report.'));
  }
};

module.exports = {
  getFinancialStatements,
  getRevenueAssuranceReport,
  getTaxComplianceReport,
};