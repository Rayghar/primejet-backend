const DailySummary = require('../models/dailySummary.model');
const SaleTransaction = require('../models/saleTransaction.model');
const ExpenseTransaction = require('../models/expenseTransaction.model');
const Plant = require('../models/plant.model');
const { v4: uuidv4 } = require('uuid');
const HttpError = require('../utils/HttpError');
const mongoose = require('mongoose');

const startOfDay = (date) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
};

const endOfDay = (date) => {
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);
    return d;
};

const getDailySummaryInProgress = async (branchObjectId) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    console.debug(`[DEBUG] Service: Searching for in-progress summary for branch ID: ${branchObjectId}`);
    return DailySummary.findOne({
        branchId: branchObjectId,
        status: 'in_progress',
        date: { $gte: today },
    });
};

const createOrGetDailySummary = async (branchId, cashierName, pricePerKg, userId) => {
    console.debug('[DEBUG] Service: createOrGetDailySummary called with:', { branchId, cashierName, pricePerKg }, 'at', new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }));
    const today = new Date();
    const start = new Date(today.setHours(0, 0, 0, 0));
    const end = new Date(today.setHours(23, 59, 59, 999));

    let dailySummary = await DailySummary.findOne({ branchId, date: { $gte: start, $lte: end } });
    if (dailySummary) {
        console.debug('[DEBUG] Service: Found existing daily summary:', dailySummary._id);
        dailySummary.cashierName = cashierName; // Update if needed
        dailySummary.pricePerKg = pricePerKg;
        await dailySummary.save();
    } else {
        console.debug('[DEBUG] Service: Creating new daily summary');
        dailySummary = new DailySummary({
            summaryId: uuidv4(), // Ensure unique summaryId
            date: today,
            branchId,
            cashierName,
            pricePerKg,
            status: 'in_progress',
            openingMeters: { meterA: 0, meterB: 0 },
            closingMeters: { meterA: 0, meterB: 0 },
            sales: { totalRevenue: 0, totalKgSold: 0, posAmount: 0, cashAmount: 0, transferAmount: 0, items: [] },
            expenses: { totalAmount: 0, items: [] },
            reconciliation: { calculatedRevenue: 0, discrepancy: 0 },
            managerApproval: { isApproved: false, approvedBy: null, approvedAt: null, rejectionReason: null },
        });
        await dailySummary.save();
    }
    return dailySummary;
};

const updateSummaryMeters = async (summaryId, metersData) => {
    console.debug('[DEBUG] Service: Updating meters for summary ID:', summaryId, 'with data:', metersData);
    const summary = await DailySummary.findById(summaryId);
    if (!summary) {
        console.error('[DEBUG] Service: Daily summary not found for ID:', summaryId);
        throw new HttpError(404, 'Daily summary not found.');
    }

    summary.openingMeters = metersData.openingMeters;
    summary.closingMeters = metersData.closingMeters;
    summary.pricePerKg = metersData.pricePerKg;

    // Recalculate reconciliation
    const meterA_kg = summary.closingMeters.meterA - summary.openingMeters.meterA;
    const meterB_kg = summary.closingMeters.meterB - summary.openingMeters.meterB;
    const totalMetersKg = (meterA_kg || 0) + (meterB_kg || 0);
    summary.reconciliation.calculatedRevenue = totalMetersKg * summary.pricePerKg;
    summary.reconciliation.discrepancy = summary.sales.totalRevenue - summary.reconciliation.calculatedRevenue;

    await summary.save();
    console.debug('[DEBUG] Service: Meters updated for summary ID:', summaryId);
    return summary;
};

const logSale = async (summaryId, branchId, cashierId, transactionType, amount, kgSold, pricePerKg) => {
    console.debug('[DEBUG] Service: Logging sale for summary ID:', summaryId, 'with data:', { branchId, cashierId, transactionType, amount, kgSold, pricePerKg });
    const sale = new SaleTransaction({
        dailySummaryId: mongoose.Types.ObjectId(summaryId),
        branchId: mongoose.Types.ObjectId(branchId),
        cashierId: mongoose.Types.ObjectId(cashierId),
        transactionType,
        amount,
        kgSold,
        pricePerKg,
    });
    await sale.save();
    console.debug('[DEBUG] Service: Sale transaction created with ID:', sale._id);

    const summary = await DailySummary.findById(summaryId);
    if (!summary) {
        console.error('[DEBUG] Service: ERROR - Daily summary not found for ID:', summaryId);
        throw new HttpError(404, 'Daily summary not found');
    }

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
    summary.reconciliation.calculatedRevenue = totalMetersKg * summary.pricePerKg;
    summary.reconciliation.discrepancy = summary.sales.totalRevenue - summary.reconciliation.calculatedRevenue;

    await summary.save();
    console.debug('[DEBUG] Service: Daily summary updated with new sale totals.');
    return sale;
};

const createSaleEntry = async (saleData) => {
    console.debug('[DEBUG] Service: createSaleEntry called with:', saleData);
    const summary = await DailySummary.findById(saleData.dailySummaryId);
    if (!summary) {
        console.error('[DEBUG] Service: Daily summary not found for ID:', saleData.dailySummaryId);
        throw new HttpError(404, 'Daily summary not found.');
    }

    const newSale = new SaleTransaction({
        ...saleData,
        dailySummaryId: mongoose.Types.ObjectId(saleData.dailySummaryId),
        branchId: mongoose.Types.ObjectId(saleData.branchId),
        cashierId: mongoose.Types.ObjectId(saleData.cashierId),
    });
    await newSale.save();

    // Update daily summary totals
    summary.sales.totalRevenue += newSale.amount;
    summary.sales.totalKgSold += newSale.kgSold;
    summary.reconciliation.discrepancy = summary.sales.totalRevenue - summary.reconciliation.calculatedRevenue;
    await summary.save();

    console.debug('[DEBUG] Service: Sale entry created and summary updated:', newSale._id);
    return newSale;
};

const createExpenseEntry = async (expenseData) => {
    console.debug('[DEBUG] Service: createExpenseEntry called with:', expenseData);
    const summary = await DailySummary.findById(expenseData.dailySummaryId);
    if (!summary) {
        console.error('[DEBUG] Service: Daily summary not found for ID:', expenseData.dailySummaryId);
        throw new HttpError(404, 'Daily summary not found.');
    }

    const newExpense = new ExpenseTransaction({
        ...expenseData,
        dailySummaryId: mongoose.Types.ObjectId(expenseData.dailySummaryId),
        branchId: mongoose.Types.ObjectId(expenseData.branchId),
        cashierId: mongoose.Types.ObjectId(expenseData.cashierId),
    });
    await newExpense.save();

    // Update daily summary totals
    summary.expenses.totalAmount += newExpense.amount;
    summary.expenses.items.push({ category: newExpense.category, amount: newExpense.amount, description: newExpense.description, createdAt: new Date() });
    await summary.save();

    console.debug('[DEBUG] Service: Expense entry created and summary updated:', newExpense._id);
    return newExpense;
};

const logExpense = async (summaryId, branchId, cashierId, category, amount, description) => {
    console.debug('[DEBUG] Service: Logging expense for summary ID:', summaryId, 'with data:', { branchId, cashierId, category, amount, description });
    const expense = new ExpenseTransaction({
        dailySummaryId: mongoose.Types.ObjectId(summaryId),
        branchId: mongoose.Types.ObjectId(branchId),
        cashierId: mongoose.Types.ObjectId(cashierId),
        category,
        amount,
        description,
    });
    await expense.save();
    console.debug('[DEBUG] Service: Expense transaction created with ID:', expense._id);

    const summary = await DailySummary.findById(summaryId);
    if (!summary) {
        console.error('[DEBUG] Service: ERROR - Daily summary not found for ID:', summaryId);
        throw new HttpError(404, 'Daily summary not found');
    }

    summary.expenses.items.push({ category, amount, description, createdAt: new Date() });
    summary.expenses.totalAmount = (summary.expenses.totalAmount || 0) + amount;

    await summary.save();
    console.debug('[DEBUG] Service: Daily summary updated with new expense totals.');
    return expense;
};

const getDailyEntries = async (summaryId) => {
    console.debug('[DEBUG] Service: Fetching daily entries for summary ID:', summaryId);
    const sales = await SaleTransaction.find({ dailySummaryId: mongoose.Types.ObjectId(summaryId) });
    const expenses = await ExpenseTransaction.find({ dailySummaryId: mongoose.Types.ObjectId(summaryId) });
    const allEntries = [...sales, ...expenses].sort((a, b) => b.createdAt - a.createdAt);
    console.debug('[DEBUG] Service: Fetched', allEntries.length, 'entries.');
    return allEntries;
};

const finalizeDailySummary = async (summaryId) => {
    console.debug('[DEBUG] Service: Finalizing summary ID:', summaryId);
    const summary = await DailySummary.findById(summaryId);
    if (!summary) {
        console.error('[DEBUG] Service: Daily summary not found for ID:', summaryId);
        throw new HttpError(404, 'Daily summary not found.');
    }

    summary.status = 'pending_approval';
    await summary.save();
    console.debug('[DEBUG] Service: Summary finalized:', summaryId);
    return summary;
};

const getDailySummaryReport = async (summaryId) => {
    console.debug('[DEBUG] Service: Getting report for summary ID:', summaryId);
    const summary = await DailySummary.findById(summaryId)
                                      .populate('branchId')
                                      .lean();
    if (!summary) {
        console.error('[DEBUG] Service: ERROR - Daily summary not found for ID:', summaryId);
        throw new HttpError(404, 'Daily summary not found');
    }

    const transactions = await getDailyEntries(summaryId);
    console.debug('[DEBUG] Service: Fetched report with', transactions.length, 'transactions.');
    return {
        summary,
        transactions,
    };
};

const getPendingSummaries = async () => {
    console.debug('[DEBUG] Service: Fetching pending summaries.');
    return DailySummary.find({ status: 'pending_approval' }).populate('branchId').sort({ createdAt: -1 });
};

const updateDailySummaryStatus = async (summaryId, newStatus, approverId, rejectionReason = null) => {
    console.debug('[DEBUG] Service: Updating summary status for ID:', summaryId, 'to', newStatus);
    const summary = await DailySummary.findById(summaryId);
    if (!summary) {
        console.error('[DEBUG] Service: ERROR - Daily summary not found for ID:', summaryId);
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
        summary.managerApproval.rejectionReason = rejectionReason;
    } else {
        console.error('[DEBUG] Service: ERROR - Invalid status update:', newStatus);
        throw new HttpError(400, 'Invalid status for update.');
    }
    await summary.save();
    console.debug('[DEBUG] Service: Summary status for', summaryId, 'updated successfully.');
    return summary;
};

const getTransactionHistory = async (filters) => {
    console.debug('[DEBUG] Service: Getting transaction history with filters:', filters);
    const { startDate, endDate, branchId } = filters;
    const query = {};
    if (startDate) query.createdAt = { $gte: new Date(startDate) };
    if (endDate) query.createdAt = { ...query.createdAt, $lte: new Date(endDate) };
    if (branchId) {
        const branch = await Plant.findOne({ plantId: branchId });
        if (branch) {
            query.branchId = branch._id;
        } else {
            console.warn(`[DEBUG] Service: Branch with UUID ${branchId} not found, returning empty history.`);
            return [];
        }
    }

    const sales = await SaleTransaction.find(query).populate('branchId').lean();
    const expenses = await ExpenseTransaction.find(query).populate('branchId').lean();

    const history = [...sales, ...expenses];
    history.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    console.debug(`[DEBUG] Service: Found a total of ${history.length} transactions.`);
    return history;
};

const bulkAddDailySummaries = async (summaries) => {
    if (!Array.isArray(summaries) || summaries.length === 0) {
        throw new HttpError(400, 'Invalid or empty array of summaries provided.');
    }
    console.debug(`[DEBUG] Service: Starting bulk migration for ${summaries.length} daily summaries.`);
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
    console.debug(`[DEBUG] Service: Successfully migrated ${result.length} daily summaries.`);
    return result;
};

const bulkAddExpenseTransactions = async (expenses) => {
    if (!Array.isArray(expenses) || expenses.length === 0) {
        throw new HttpError(400, 'Invalid or empty array of expenses provided.');
    }
    console.debug(`[DEBUG] Service: Starting bulk migration for ${expenses.length} expense transactions.`);
    const validatedExpenses = await Promise.all(expenses.map(async expense => {
        if (expense.branchId) {
            const branch = await Plant.findOne({ plantId: expense.branchId });
            if (branch) {
                expense.branchId = branch._id;
            } else {
                throw new HttpError(404, `Branch with UUID ${expense.branchId} not found.`);
            }
        }
        if (expense.dailySummaryId) {
            expense.dailySummaryId = mongoose.Types.ObjectId(expense.dailySummaryId);
        }
        if (expense.cashierId) {
            expense.cashierId = mongoose.Types.ObjectId(expense.cashierId);
        }
        return expense;
    }));
    const result = await ExpenseTransaction.insertMany(validatedExpenses);
    console.debug(`[DEBUG] Service: Successfully migrated ${result.length} expense transactions.`);
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
    bulkAddExpenseTransactions,
    createSaleEntry,
    createExpenseEntry,
};