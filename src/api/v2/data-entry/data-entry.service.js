// src/api/v2/data-entry/data-entry.service.js

const DailySummary = require('../../../models/dailySummary.model');
const SaleTransaction = require('../../../models/saleTransaction.model');
const ExpenseTransaction = require('../../../models/expenseTransaction.model');
const Plant = require('../../../models/plant.model');
const { v4: uuidv4 } = require('uuid');
const HttpError = require('../../../utils/HttpError');
const mongoose = require('mongoose');

// Helper functions remain the same
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

// --- Main Service Functions ---
// (createOrGetDailySummary, updateSummaryMeters, createSaleEntry, createExpenseEntry, etc. remain unchanged)
const createOrGetDailySummary = async (branchId, cashierName, pricePerKg, userId) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let dailySummary = await DailySummary.findOne({ 
        branchId, 
        date: { $gte: startOfDay(today) },
        status: { $in: ['in_progress', 'pending_approval'] } 
    });

    if (dailySummary) {
        console.debug('[DEBUG] Service: Found existing daily summary:', dailySummary._id);
        dailySummary.cashierName = cashierName;
        dailySummary.pricePerKg = pricePerKg;
        await dailySummary.save();
    } else {
        console.debug('[DEBUG] Service: No active summary found. Creating new daily summary.');
        dailySummary = new DailySummary({
            summaryId: uuidv4(),
            date: new Date(),
            branchId,
            cashierName,
            pricePerKg,
            status: 'in_progress',
            openingMeters: { meterA: 0, meterB: 0 },
            closingMeters: { meterA: 0, meterB: 0 },
            sales: { totalRevenue: 0, totalKgSold: 0, posAmount: 0, cashAmount: 0, transferAmount: 0, items: [] },
            expenses: { total: 0, items: [] },
            reconciliation: { calculatedRevenue: 0, discrepancy: 0 },
            managerApproval: {},
        });
        await dailySummary.save();
    }
    return dailySummary;
};

const updateSummaryMeters = async (summaryId, metersData) => {
    const summary = await DailySummary.findById(summaryId);
    if (!summary) throw new HttpError(404, 'Daily summary not found.');

    summary.openingMeters = metersData.openingMeters;
    summary.closingMeters = metersData.closingMeters;
    summary.pricePerKg = metersData.pricePerKg;

    const meterA_kg = (summary.closingMeters.meterA || 0) - (summary.openingMeters.meterA || 0);
    const meterB_kg = (summary.closingMeters.meterB || 0) - (summary.openingMeters.meterB || 0);
    const totalMetersKg = meterA_kg + meterB_kg;
    
    summary.reconciliation.calculatedRevenue = totalMetersKg * summary.pricePerKg;
    summary.reconciliation.discrepancy = summary.sales.totalRevenue - summary.reconciliation.calculatedRevenue;

    await summary.save();
    return summary;
};

const createSaleEntry = async (saleData) => {
    const summary = await DailySummary.findById(saleData.dailySummaryId);
    if (!summary) throw new HttpError(404, 'Daily summary not found.');

    const newSale = new SaleTransaction({ ...saleData });
    await newSale.save();

    summary.sales.totalRevenue = (summary.sales.totalRevenue || 0) + newSale.amount;
    summary.sales.totalKgSold = (summary.sales.totalKgSold || 0) + newSale.kgSold;
    
    if (newSale.transactionType === 'POS') {
        summary.sales.posAmount = (summary.sales.posAmount || 0) + newSale.amount;
    } else if (newSale.transactionType === 'CASH' || newSale.transactionType === 'Cash') {
        summary.sales.cashAmount = (summary.sales.cashAmount || 0) + newSale.amount;
    } else if (newSale.transactionType === 'TRANSFER' || newSale.transactionType === 'Transfer') {
        summary.sales.transferAmount = (summary.sales.transferAmount || 0) + newSale.amount;
    }

    summary.sales.items.push(newSale._id);
    await summary.save();

    return newSale;
};

const createExpenseEntry = async (expenseData) => {
    const summary = await DailySummary.findById(expenseData.dailySummaryId);
    if (!summary) throw new HttpError(404, 'Daily summary not found.');

    const newExpense = new ExpenseTransaction({ ...expenseData });
    await newExpense.save();

    summary.expenses.total = (summary.expenses.total || 0) + newExpense.amount;
    summary.expenses.items.push(newExpense._id);
    await summary.save();

    return newExpense;
};

const getDailyEntries = async (summaryId) => {
    const summary = await DailySummary.findById(summaryId)
        .populate('sales.items')
        .populate('expenses.items')
        .lean();

    if (!summary) throw new HttpError(404, 'Daily summary not found.');

    const sales = summary.sales.items.map(s => ({ ...s, type: 'sale' }));
    const expenses = summary.expenses.items.map(e => ({ ...e, type: 'expense' }));

    return [...sales, ...expenses].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
};

const finalizeDailySummary = async (summaryId) => {
    const summary = await DailySummary.findById(summaryId);
    if (!summary) throw new HttpError(404, 'Daily summary not found.');

    if (summary.status !== 'in_progress') {
        throw new HttpError(400, 'Summary cannot be finalized.');
    }

    summary.status = 'pending_approval';
    await summary.save();
    return summary;
};

const getDailySummaryReport = async (summaryId) => {
    const summary = await DailySummary.findById(summaryId)
        .populate('branchId', 'name')
        .populate('sales.items')
        .populate('expenses.items')
        .lean();

    if (!summary) throw new HttpError(404, 'Daily summary not found.');

    return summary;
};

const getPendingSummaries = async () => {
    return await DailySummary.find({ status: 'pending_approval' })
        .populate('branchId', 'name')
        .sort({ date: -1 })
        .lean();
};

const updateDailySummaryStatus = async (summaryId, newStatus, rejectionReason, approverId) => {
    const summary = await DailySummary.findById(summaryId);
    if (!summary) throw new HttpError(404, 'Daily summary not found.');

    if (summary.status !== 'pending_approval') {
        throw new HttpError(400, 'Only pending summaries can be updated.');
    }

    summary.status = newStatus;
    summary.managerApproval = {
        isApproved: newStatus === 'approved',
        approvedBy: approverId,
        approvalDate: new Date(),
        rejectionReason: newStatus === 'rejected' ? rejectionReason : null,
    };
    
    await summary.save();
    return summary;
};

const getTransactionHistory = async (filters = {}) => {
    const { startDate, endDate, branchId } = filters;
    const query = {};

    // Note: This query correctly uses the 'date' field. 
    // All new and migrated data should have this field.
    if (startDate) query.date = { $gte: startOfDay(startDate) };
    if (endDate) {
        if (!query.date) query.date = {};
        query.date.$lte = endOfDay(endDate);
    }
    if (branchId) query.branchId = branchId;

    const sales = await SaleTransaction.find(query).populate('branchId').lean();
    const expenses = await ExpenseTransaction.find(query).populate('branchId').lean();

    const history = [...sales.map(s => ({...s, type: 'Sale'})), ...expenses.map(e => ({...e, type: 'Expense'}))];
    
    // FIX: Updated sorting logic to use 'date' first, and fall back to 'createdAt'.
    history.sort((a, b) => {
        const dateA = new Date(a.date || a.createdAt);
        const dateB = new Date(b.date || b.createdAt);
        return dateB - dateA;
    });

    return history;
};

const bulkAddDailySummaries = async (summaries) => {
    if (!Array.isArray(summaries) || summaries.length === 0) {
        throw new HttpError(400, 'Invalid or empty array of summaries provided.');
    }
    console.debug(`[DEBUG] Service: Starting bulk migration for ${summaries.length} daily summaries.`);
    
    // REMEDIATION: Removed the faulty branch lookup. Mongoose will cast the string ObjectId correctly.
    const validatedSummaries = summaries.map(summary => {
        if (!summary.summaryId) {
            // In the log, the field was `dailySummaryId`, let's stick to that for consistency
            summary.summaryId = summary.dailySummaryId || uuidv4();
            delete summary.dailySummaryId;
        }
        if (!summary.status) {
            summary.status = 'approved';
        }
        return summary;
    });

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
        if (!expense.date) {
            // Ensure a date is provided for migration
            throw new HttpError(400, `Missing 'date' field for expense: ${expense.description}`);
        }

        if (expense.dailySummaryId) {
            const summary = await DailySummary.findOne({ summaryId: expense.dailySummaryId });
            if (!summary) {
                throw new HttpError(404, `Daily summary with UUID ${expense.dailySummaryId} not found.`);
            }
            expense.dailySummaryId = summary._id;
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
    getDailyEntries,
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