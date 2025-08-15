const dataEntryService = require('./data-entry.service');
const HttpError = require('../../../utils/HttpError');
const mongoose = require('mongoose');

const createOrGetSummary = async (req, res, next) => {
    try {
        console.debug('[DEBUG] Controller: Incoming request body for createOrGetSummary:', JSON.stringify(req.body, null, 2), 'at', new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }));
        const { branchId, cashierName, pricePerKg } = req.body;
        if (!branchId || !cashierName || !pricePerKg) {
            throw new HttpError(400, 'Missing required fields: branchId, cashierName, or pricePerKg');
        }
        if (!mongoose.Types.ObjectId.isValid(branchId)) {
            throw new HttpError(400, `Invalid branchId: ${branchId}`);
        }
        if (typeof cashierName !== 'string' || cashierName.length < 3 || cashierName.length > 100) {
            throw new HttpError(400, 'Cashier name must be a string between 3 and 100 characters');
        }
        if (typeof pricePerKg !== 'number' || pricePerKg <= 0.01) {
            throw new HttpError(400, 'Price per kg must be a number greater than 0.01');
        }
        const summary = await dataEntryService.createOrGetDailySummary(branchId, cashierName, pricePerKg, req.user.id);
        res.status(200).json(summary);
    } catch (error) {
        console.error('[DEBUG] Controller: Error in createOrGetSummary:', error, 'at', new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }));
        next(error);
    }
};

const updateMeters = async (req, res, next) => {
    try {
        const { summaryId } = req.params;
        const { openingMeters, closingMeters, pricePerKg } = req.body;
        console.debug('[DEBUG] Controller: Updating meters for summary ID:', summaryId, 'with data:', JSON.stringify({ openingMeters, closingMeters, pricePerKg }, null, 2), 'at', new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }));
        if (!mongoose.Types.ObjectId.isValid(summaryId)) {
            throw new HttpError(400, `Invalid summaryId: ${summaryId}`);
        }
        if (!openingMeters || !closingMeters || !pricePerKg) {
            throw new HttpError(400, 'Missing required fields: openingMeters, closingMeters, or pricePerKg');
        }
        if (typeof openingMeters.meterA !== 'number' || openingMeters.meterA < 0) {
            throw new HttpError(400, 'Opening meter A must be a non-negative number');
        }
        if (typeof closingMeters.meterA !== 'number' || closingMeters.meterA < 0) {
            throw new HttpError(400, 'Closing meter A must be a non-negative number');
        }
        if (typeof openingMeters.meterB !== 'number' && openingMeters.meterB !== undefined) {
            throw new HttpError(400, 'Opening meter B must be a number or undefined');
        }
        if (typeof closingMeters.meterB !== 'number' && closingMeters.meterB !== undefined) {
            throw new HttpError(400, 'Closing meter B must be a number or undefined');
        }
        if (typeof pricePerKg !== 'number' || pricePerKg <= 0.01) {
            throw new HttpError(400, 'Price per kg must be a number greater than 0.01');
        }
        const updatedSummary = await dataEntryService.updateSummaryMeters(summaryId, { openingMeters, closingMeters, pricePerKg });
        res.status(200).json(updatedSummary);
    } catch (error) {
        console.error('[DEBUG] Controller: Error in updateMeters:', error, 'at', new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }));
        next(error);
    }
};

const createSaleEntry = async (req, res, next) => {
    try {
        console.debug('[DEBUG] Controller: Incoming request body for createSaleEntry:', JSON.stringify(req.body, null, 2), 'at', new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }));
        const { branchId, dailySummaryId, kgSold, amount, transactionType, pricePerKg } = req.body;
        if (!branchId || !dailySummaryId || !kgSold || !amount || !transactionType || !pricePerKg) {
            throw new HttpError(400, 'Missing required fields for sale entry');
        }
        if (!mongoose.Types.ObjectId.isValid(branchId) || !mongoose.Types.ObjectId.isValid(dailySummaryId)) {
            throw new HttpError(400, 'Invalid branchId or dailySummaryId');
        }
        if (typeof kgSold !== 'number' || kgSold <= 0.01) {
            throw new HttpError(400, 'kgSold must be a number greater than 0.01');
        }
        if (typeof amount !== 'number' || amount <= 0.01) {
            throw new HttpError(400, 'Amount must be a number greater than 0.01');
        }
        if (!['POS', 'CASH', 'TRANSFER'].includes(transactionType.toUpperCase())) {
            throw new HttpError(400, 'Invalid transaction type');
        }
        if (typeof pricePerKg !== 'number' || pricePerKg <= 0.01) {
            throw new HttpError(400, 'pricePerKg must be a number greater than 0.01');
        }
        const saleData = {
            branchId,
            dailySummaryId,
            kgSold,
            amount,
            transactionType: transactionType.toUpperCase(),
            pricePerKg,  // Add this
            cashierId: req.user.id,
            date: new Date(),
        };
        const newSale = await dataEntryService.createSaleEntry(saleData);
        res.status(201).json(newSale);
    } catch (error) {
        console.error('[DEBUG] Controller: Error in createSaleEntry:', error, 'at', new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }));
        next(error);
    }
};

const createExpenseEntry = async (req, res, next) => {
    try {
        console.debug('[DEBUG] Controller: Raw request body for createExpenseEntry:', JSON.stringify(req.body, null, 2), 'at', new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }));
        const { dailySummaryId, branchId, category, amount, description, date } = req.body;
        if (!dailySummaryId || !branchId || !category || !amount || !description || !date) {
            throw new HttpError(400, 'Missing required fields: dailySummaryId, branchId, category, amount, description, or date');
        }
        if (!mongoose.Types.ObjectId.isValid(dailySummaryId)) {
            throw new HttpError(400, `Invalid dailySummaryId: ${dailySummaryId}`);
        }
        if (!mongoose.Types.ObjectId.isValid(branchId)) {
            throw new HttpError(400, `Invalid branchId: ${branchId}`);
        }
        if (!['Fuel', 'Maintenance', 'Salaries', 'Utilities', 'Miscellaneous'].includes(category)) {
            throw new HttpError(400, `Invalid category: ${category}`);
        }
        if (typeof amount !== 'number' || amount <= 0.01) {
            throw new HttpError(400, 'Amount must be a number greater than 0.01');
        }
        if (typeof description !== 'string' || description.trim().length === 0) {
            throw new HttpError(400, 'Description must be a non-empty string');
        }
        if (!Date.parse(date)) {
            throw new HttpError(400, `Invalid date: ${date}`);
        }
        const expense = await dataEntryService.createExpenseEntry(req.body);
        res.status(201).json(expense);
    } catch (error) {
        console.error('[DEBUG] Controller: Error in createExpenseEntry:', error, 'at', new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }));
        next(error);
    }
};

const getDailyEntries = async (req, res, next) => {
    try {
        const { summaryId } = req.params;
        console.debug('[DEBUG] Controller: Fetching daily entries for summary ID:', summaryId, 'at', new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }));
        if (!mongoose.Types.ObjectId.isValid(summaryId)) {
            throw new HttpError(400, `Invalid summaryId: ${summaryId}`);
        }
        const entries = await dataEntryService.getDailyEntries(summaryId);
        res.status(200).json(entries);
    } catch (error) {
        console.error('[DEBUG] Controller: Error in getDailyEntries:', error, 'at', new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }));
        next(error);
    }
};

const finalizeSummary = async (req, res, next) => {
    try {
        const { summaryId } = req.params;
        console.debug('[DEBUG] Controller: Finalizing summary ID:', summaryId, 'at', new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }));
        if (!mongoose.Types.ObjectId.isValid(summaryId)) {
            throw new HttpError(400, `Invalid summaryId: ${summaryId}`);
        }
        const finalizedSummary = await dataEntryService.finalizeDailySummary(summaryId);
        res.status(200).json(finalizedSummary);
    } catch (error) {
        console.error('[DEBUG] Controller: Error in finalizeSummary:', error, 'at', new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }));
        next(error);
    }
};

const getSummaryReport = async (req, res, next) => {
    try {
        const { summaryId } = req.params;
        console.debug('[DEBUG] Controller: Fetching summary report for ID:', summaryId, 'at', new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }));
        if (!mongoose.Types.ObjectId.isValid(summaryId)) {
            throw new HttpError(400, `Invalid summaryId: ${summaryId}`);
        }
        const report = await dataEntryService.getDailySummaryReport(summaryId);
        res.status(200).json(report);
    } catch (error) {
        console.error('[DEBUG] Controller: Error in getSummaryReport:', error, 'at', new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }));
        next(error);
    }
};

const getPendingSummariesForApproval = async (req, res, next) => {
    try {
        console.debug('[DEBUG] Controller: Fetching pending summaries for approval at', new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }));
        const summaries = await dataEntryService.getPendingSummaries();
        res.status(200).json(summaries);
    } catch (error) {
        console.error('[DEBUG] Controller: Error in getPendingSummariesForApproval:', error, 'at', new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }));
        next(error);
    }
};

const approveDailySummary = async (req, res, next) => {
    try {
        const { summaryId } = req.params;
        if (!req.user || !req.user.id) {
            throw new HttpError(401, 'User not authenticated.');
        }
        console.debug('[DEBUG] Controller: Approving summary ID:', summaryId, 'by user:', req.user.id, 'at', new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }));
        if (!mongoose.Types.ObjectId.isValid(summaryId)) {
            throw new HttpError(400, `Invalid summaryId: ${summaryId}`);
        }
        const updatedSummary = await dataEntryService.updateDailySummaryStatus(summaryId, 'approved', req.user.id);
        res.status(200).json(updatedSummary);
    } catch (error) {
        console.error('[DEBUG] Controller: Error in approveDailySummary:', error, 'at', new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }));
        next(error);
    }
};

const rejectDailySummary = async (req, res, next) => {
    try {
        const { summaryId } = req.params;
        const { reason } = req.body;
        if (!req.user || !req.user.id) {
            throw new HttpError(401, 'User not authenticated.');
        }
        if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
            throw new HttpError(400, 'Rejection reason is required and must be a non-empty string');
        }
        console.debug('[DEBUG] Controller: Rejecting summary ID:', summaryId, 'by user:', req.user.id, 'with reason:', reason, 'at', new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }));
        if (!mongoose.Types.ObjectId.isValid(summaryId)) {
            throw new HttpError(400, `Invalid summaryId: ${summaryId}`);
        }
        const updatedSummary = await dataEntryService.updateDailySummaryStatus(summaryId, 'rejected', req.user.id, reason);
        res.status(200).json(updatedSummary);
    } catch (error) {
        console.error('[DEBUG] Controller: Error in rejectDailySummary:', error, 'at', new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }));
        next(error);
    }
};

const getTransactionHistory = async (req, res, next) => {
    try {
        console.debug('[DEBUG] Controller: Fetching transaction history with filters:', JSON.stringify(req.query, null, 2), 'at', new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }));
        const filters = req.query;
        const { startDate, endDate, branchId } = filters;
        if (startDate && !Date.parse(startDate)) {
            throw new HttpError(400, `Invalid startDate: ${startDate}`);
        }
        if (endDate && !Date.parse(endDate)) {
            throw new HttpError(400, `Invalid endDate: ${endDate}`);
        }
        if (branchId && !mongoose.Types.ObjectId.isValid(branchId)) {
            throw new HttpError(400, `Invalid branchId: ${branchId}`);
        }
        const history = await dataEntryService.getTransactionHistory(filters);
        res.status(200).json(history);
    } catch (error) {
        console.error('[DEBUG] Controller: Error in getTransactionHistory:', error, 'at', new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }));
        next(error);
    }
};

const migrateDailySummaries = async (req, res, next) => {
    try {
        console.debug('[DEBUG] Controller: Migrating daily summaries:', JSON.stringify(req.body, null, 2), 'at', new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }));
        const summaries = req.body;
        if (!Array.isArray(summaries) || summaries.length === 0) {
            throw new HttpError(400, 'Summaries must be a non-empty array');
        }
        for (const summary of summaries) {
            if (!summary.date || !Date.parse(summary.date)) {
                throw new HttpError(400, `Invalid date in summary: ${summary.date}`);
            }
            if (!mongoose.Types.ObjectId.isValid(summary.branchId)) {
                throw new HttpError(400, `Invalid branchId in summary: ${summary.branchId}`);
            }
            if (summary.cashierName && (typeof summary.cashierName !== 'string' || summary.cashierName.length < 3 || summary.cashierName.length > 100)) {
                throw new HttpError(400, 'Cashier name must be a string between 3 and 100 characters');
            }
            if (summary.status && !['in_progress', 'pending_approval', 'approved', 'rejected'].includes(summary.status)) {
                throw new HttpError(400, `Invalid status in summary: ${summary.status}`);
            }
        }
        const result = await dataEntryService.bulkAddDailySummaries(summaries);
        res.status(201).json({ message: 'Daily summaries migrated successfully.', count: result.length });
    } catch (error) {
        console.error('[DEBUG] Controller: Error in migrateDailySummaries:', error, 'at', new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }));
        next(error);
    }
};

const migrateExpenseTransactions = async (req, res, next) => {
    try {
        console.debug('[DEBUG] Controller: Migrating expense transactions:', JSON.stringify(req.body, null, 2), 'at', new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }));
        const expenses = req.body;
        if (!Array.isArray(expenses) || expenses.length === 0) {
            throw new HttpError(400, 'Expenses must be a non-empty array');
        }
        for (const expense of expenses) {
            if (!mongoose.Types.ObjectId.isValid(expense.branchId)) {
                throw new HttpError(400, `Invalid branchId in expense: ${expense.branchId}`);
            }
            if (expense.dailySummaryId && !mongoose.Types.ObjectId.isValid(expense.dailySummaryId)) {
                throw new HttpError(400, `Invalid dailySummaryId in expense: ${expense.dailySummaryId}`);
            }
            if (expense.cashierId && !mongoose.Types.ObjectId.isValid(expense.cashierId)) {
                throw new HttpError(400, `Invalid cashierId in expense: ${expense.cashierId}`);
            }
            if (expense.category && !['Fuel', 'Maintenance', 'Salaries', 'Utilities', 'Miscellaneous'].includes(expense.category)) {
                throw new HttpError(400, `Invalid category in expense: ${expense.category}`);
            }
            if (typeof expense.amount !== 'number' || expense.amount <= 0.01) {
                throw new HttpError(400, 'Amount must be a number greater than 0.01');
            }
            if (typeof expense.description !== 'string' || expense.description.trim().length === 0) {
                throw new HttpError(400, 'Description must be a non-empty string');
            }
        }
        const result = await dataEntryService.bulkAddExpenseTransactions(expenses);
        res.status(201).json({ message: 'Expense transactions migrated successfully.', count: result.length });
    } catch (error) {
        console.error('[DEBUG] Controller: Error in migrateExpenseTransactions:', error, 'at', new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }));
        next(error);
    }
};

module.exports = {
    createOrGetSummary,
    updateMeters,
    createSaleEntry,
    createExpenseEntry,
    getDailyEntries,
    finalizeSummary,
    getSummaryReport,
    getPendingSummariesForApproval,
    approveDailySummary,
    rejectDailySummary,
    getTransactionHistory,
    migrateDailySummaries,
    migrateExpenseTransactions,
};