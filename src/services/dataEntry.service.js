const DailySummary = require('../models/dailySummary.model');
const SaleTransaction = require('../models/saleTransaction.model');
const ExpenseTransaction = require('../models/expenseTransaction.model');
const Plant = require('../models/plant.model');
const { v4: uuidv4 } = require('uuid');
const HttpError = require('../utils/HttpError');
const mongoose = require('mongoose');

const createOrGetDailySummary = async (branchId, cashierName, pricePerKg, userId) => {
    const branch = await Plant.findOne({ plantId: branchId });
    if (!branch) {
        throw new HttpError(404, 'Branch not found.');
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Check if the provided branchId is a valid Mongoose ObjectId.
    // If not, we will assume it's a legacy UUID string.
    const isObjectId = mongoose.Types.ObjectId.isValid(branchId);

    let queryConditions = [
        { branchId: branch._id },
    ];

    // Add a condition to search for legacy documents with string branchId if the input isn't a valid ObjectId
    if (!isObjectId) {
        queryConditions.push({ branchId: branchId });
    }
    
    // Use the $or operator to find a daily summary by either the ObjectId or the UUID string
    let summary = await DailySummary.findOne({ 
        $or: queryConditions,
        status: 'in_progress', 
        date: { $gte: today } 
    });

    if (summary) {
        return summary;
    }

    // If no summary exists, create a new one using the correct ObjectId
    const newSummaryData = {
        summaryId: uuidv4(),
        date: new Date(),
        branchId: branch._id, // Use the Mongoose ObjectId here for all new documents
        cashierName,
        pricePerKg,
        openingMeters: { meterA: 0, meterB: 0 },
        closingMeters: { meterA: 0, meterB: 0 },
        sales: { totalKgSold: 0, calculatedRevenue: 0, posAmount: 0, cashAmount: 0, transferAmount: 0, totalRevenue: 0 },
        expenses: { total: 0, items: [] },
        reconciliation: { discrepancy: 0 },
        status: 'in_progress',
        cashierId: userId,
    };
    summary = new DailySummary(newSummaryData);
    await summary.save();
    return summary;
};

const updateSummaryMeters = async (summaryId, meters) => {
    return DailySummary.findByIdAndUpdate(summaryId, {
        'openingMeters.meterA': meters.openingMeters.meterA,
        'openingMeters.meterB': meters.openingMeters.meterB,
        'closingMeters.meterA': meters.closingMeters.meterA,
        'closingMeters.meterB': meters.closingMeters.meterB,
        pricePerKg: meters.pricePerKg
    }, { new: true });
};

const logSale = async (summaryId, branchId, cashierId, transactionType, amount, kgSold, pricePerKg) => {
    const sale = new SaleTransaction({
        dailySummaryId: summaryId,
        branchId,
        cashierId,
        transactionType,
        amount,
        kgSold,
        pricePerKg
    });
    await sale.save();

    const summary = await DailySummary.findById(summaryId);
    if (!summary) throw new HttpError(404, 'Daily summary not found');

    summary.sales.totalKgSold = (summary.sales.totalKgSold || 0) + kgSold;
    summary.sales.totalRevenue = (summary.sales.totalRevenue || 0) + amount;
    if (transactionType === 'POS') {
        summary.sales.posAmount = (summary.sales.posAmount || 0) + amount;
    } else if (transactionType === 'CASH') {
        summary.sales.cashAmount = (summary.sales.cashAmount || 0) + amount;
    } else if (transactionType === 'TRANSFER') {
        summary.sales.transferAmount = (summary.sales.transferAmount || 0) + amount;
    }
    
    const totalMetersKg = (summary.closingMeters.meterA - summary.openingMeters.meterA) +
                          (summary.closingMeters.meterB - summary.openingMeters.meterB);
    summary.sales.calculatedRevenue = totalMetersKg * summary.pricePerKg;
    summary.reconciliation.discrepancy = summary.sales.totalRevenue - summary.sales.calculatedRevenue;
    
    await summary.save();
    return sale;
};

const getDailyEntries = async (summaryId) => {
    const sales = await SaleTransaction.find({ dailySummaryId: summaryId });
    const expenses = await ExpenseTransaction.find({ dailySummaryId: summaryId });
    return [...sales, ...expenses].sort((a, b) => b.createdAt - a.createdAt);
};

const logExpense = async (summaryId, branchId, cashierId, description, amount) => {
    const expense = new ExpenseTransaction({
        dailySummaryId: summaryId,
        branchId,
        cashierId,
        description,
        amount
    });
    await expense.save();

    const summary = await DailySummary.findById(summaryId);
    if (!summary) throw new HttpError(404, 'Daily summary not found');
    
    summary.expenses.items.push({ description, amount });
    summary.expenses.total = (summary.expenses.total || 0) + amount;
    
    await summary.save();
    return expense;
};

const finalizeDailySummary = async (summaryId) => {
    const summary = await DailySummary.findById(summaryId);
    if (!summary) throw new HttpError(404, 'Daily summary not found');
    if (summary.status !== 'in_progress') {
        throw new HttpError(400, `Daily summary is already ${summary.status}.`);
    }
    summary.status = 'pending_approval';
    await summary.save();
    return summary;
};

const getDailySummaryReport = async (summaryId) => {
    const summary = await DailySummary.findById(summaryId)
                                      .populate('branchId')
                                      .lean();
    if (!summary) throw new HttpError(404, 'Daily summary not found');

    const transactions = await getDailyEntries(summaryId);

    return {
        summary,
        transactions
    };
};

const getPendingSummaries = async () => {
    return DailySummary.find({ status: 'pending_approval' }).populate('branchId').sort({ createdAt: -1 });
};

const updateDailySummaryStatus = async (summaryId, newStatus, approverId, rejectionReason = null) => {
    const summary = await DailySummary.findById(summaryId);
    if (!summary) {
        throw new HttpError(404, 'Daily summary not found.');
    }
    if (newStatus === 'approved') {
        summary.status = 'approved';
        summary.managerApproval.isApproved = true;
        summary.managerApproval.approvedBy = approverId;
        summary.managerApproval.approvalDate = new Date();
    } else if (newStatus === 'rejected') {
        summary.status = 'rejected';
        summary.managerApproval.isApproved = false;
        summary.managerApproval.approvedBy = approverId;
        summary.managerApproval.approvalDate = new Date();
    } else {
        throw new HttpError(400, 'Invalid status for update.');
    }
    await summary.save();
    return summary;
};

const getTransactionHistory = async (filters) => {
    const { startDate, endDate, branchId } = filters;
    const query = {};
    if (startDate) query.createdAt = { $gte: new Date(startDate) };
    if (endDate) query.createdAt = { ...query.createdAt, $lte: new Date(endDate) };
    if (branchId) {
        const branch = await Plant.findOne({ plantId: branchId });
        if (branch) {
            query.branchId = branch._id;
        } else {
            return [];
        }
    }

    const sales = await SaleTransaction.find(query).populate('branchId').lean();
    const expenses = await ExpenseTransaction.find(query).populate('branchId').lean();
    
    const history = [...sales, ...expenses];
    history.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return history;
};

const bulkAddDailySummaries = async (summaries) => {
    if (!Array.isArray(summaries) || summaries.length === 0) {
        throw new HttpError(400, 'Invalid or empty array of summaries provided.');
    }
    const validatedSummaries = await Promise.all(summaries.map(async summary => {
      if (!summary.summaryId) {
        summary.summaryId = uuidv4();
      }
      if (!summary.status) {
        summary.status = 'approved';
      }
      if (summary.branchId) {
        const branch = await Plant.findOne({ plantId: summary.branchId });
        if (branch) {
            summary.branchId = branch._id;
        } else {
            throw new HttpError(404, `Branch with UUID ${summary.branchId} not found.`);
        }
      }
      return summary;
    }));

    const result = await DailySummary.insertMany(validatedSummaries);
    return result;
};

const bulkAddExpenseTransactions = async (expenses) => {
    if (!Array.isArray(expenses) || expenses.length === 0) {
        throw new HttpError(400, 'Invalid or empty array of expenses provided.');
    }
    const validatedExpenses = await Promise.all(expenses.map(async expense => {
        if (expense.branchId) {
            const branch = await Plant.findOne({ plantId: expense.branchId });
            if (branch) {
                expense.branchId = branch._id;
            } else {
                throw new HttpError(404, `Branch with UUID ${expense.branchId} not found.`);
            }
        }
        return expense;
    }));
    const result = await ExpenseTransaction.insertMany(validatedExpenses);
    return result;
};

module.exports = {
    createOrGetDailySummary,
    updateSummaryMeters,
    logSale,
    getDailyEntries,
    logExpense,
    finalizeDailySummary,
    getDailySummaryReport,
    getPendingSummaries,
    updateDailySummaryStatus,
    getTransactionHistory,
    bulkAddDailySummaries,
    bulkAddExpenseTransactions
};