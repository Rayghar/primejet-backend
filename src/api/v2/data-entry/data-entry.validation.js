// src/api/v2/data-entry/data-entry.validation.js
const Joi = require('joi');

// Base schema for common data entry fields
const baseDataEntrySchema = Joi.object({
    branchId: Joi.string().required().description('ID of the branch.'),
    date: Joi.date().iso().required().description('Date of the transaction (YYYY-MM-DD).'),
    dailySummaryId: Joi.string().required().description('ID of the associated daily summary.'),
    submittedBy: Joi.string().email().optional().description('Email of the user who submitted the entry.'),
});

// Schema for logging a new sales transaction
const logSaleSchema = baseDataEntrySchema.keys({
    kgSold: Joi.number().min(0.01).required().description('Kilograms of LPG sold.'),
    amount: Joi.number().min(0.01).required().description('Total revenue from the sale.'),
    transactionType: Joi.string().valid('Cash', 'POS', 'Transfer').required().description('Payment method used.'),
});

// Schema for logging a new expense transaction
const logExpenseSchema = baseDataEntrySchema.keys({
    category: Joi.string().required().valid('Fuel', 'Maintenance', 'Salaries', 'Utilities', 'Miscellaneous').description('Category of the expense.'),
    amount: Joi.number().min(0.01).required().description('Amount of the expense.'),
    description: Joi.string().required().description('Description of the expense.'),
});

// Schema for daily summary meters
const dailySummaryMetersSchema = Joi.object({
    openingMeterA: Joi.number().min(0).required().description('Opening meter reading for meter A.'),
    closingMeterA: Joi.number().min(0).required().description('Closing meter reading for meter A.'),
    openingMeterB: Joi.number().min(0).optional().description('Opening meter reading for meter B.'),
    closingMeterB: Joi.number().min(0).optional().description('Closing meter reading for meter B.'),
    pricePerKg: Joi.number().min(0.01).required().description('Price per kilogram on this day.'),
});

// Schema for daily summary sales
const dailySummarySalesSchema = Joi.object({
    posAmount: Joi.number().min(0).required().description('Total POS sales amount.'),
    cashAmount: Joi.number().min(0).required().description('Total cash sales amount.'),
    transferAmount: Joi.number().min(0).required().description('Total transfer sales amount.'),
    totalRevenue: Joi.number().min(0).required().description('Total revenue from sales.'),
    totalKgSold: Joi.number().min(0).required().description('Total kilograms sold.'),
    items: Joi.array().items(Joi.string()).description('Array of sale transaction IDs.'),
});

// Schema for daily summary expenses (array of objects)
const dailySummaryExpensesItemSchema = Joi.object({
    category: Joi.string().required().valid('Fuel', 'Maintenance', 'Salaries', 'Utilities', 'Miscellaneous').description('Expense category.'),
    amount: Joi.number().min(0.01).required().description('Expense amount.'),
    date: Joi.date().iso().required().description('Date of the expense.'),
    description: Joi.string().required().description('Description of the expense.'),
});

const dailySummaryExpensesSchema = Joi.object({
    totalAmount: Joi.number().min(0).required().description('Total expense amount.'),
    items: Joi.array().items(dailySummaryExpensesItemSchema).default([]).description('List of expense items.'),
});

// Schema for adding/updating a daily summary
const addDailySummarySchema = Joi.object({
    summaryId: Joi.string().optional().allow(null).description('Optional ID if updating an existing summary.'),
    date: Joi.date().iso().required().description('Date of the daily summary.'),
    branchId: Joi.string().required().description('Branch ID for the daily summary.'),
    cashierName: Joi.string().min(3).max(100).required().description('Name of the cashier.'),
    meters: dailySummaryMetersSchema.required().description('Meter readings for the day.'),
    sales: dailySummarySalesSchema.required().description('Aggregated sales data for the day.'),
    expenses: dailySummaryExpensesSchema.required().description('Aggregated expense data for the day.'),
    status: Joi.string().valid('in_progress', 'pending_approval', 'approved', 'rejected').optional().description('Status of the daily summary.'),
    managerApproval: Joi.object({
        isApproved: Joi.boolean().optional(),
        approvedBy: Joi.string().email().optional(),
        approvedAt: Joi.date().iso().optional(),
        rejectionReason: Joi.string().optional(),
    }).optional(),
});

// Schema for updating daily summary status (approval queue)
const updateSummaryStatusSchema = Joi.object({
    status: Joi.string().valid('approved', 'rejected').required(),
    reason: Joi.string().when('status', {
        is: 'rejected',
        then: Joi.string().required(),
        otherwise: Joi.string().optional()
    }),
});

exports.createSaleEntry = {
    body: logSaleSchema,
};

exports.createExpenseEntry = {
    body: logExpenseSchema,
};

exports.updateMeters = {
    params: Joi.object({
        summaryId: Joi.string().required(),
    }),
    body: dailySummaryMetersSchema,
};

exports.addDailySummary = {
    body: addDailySummarySchema,
};

exports.updateSummaryStatus = {
    body: updateSummaryStatusSchema,
};

exports.finalizeDailySummary = {
    params: Joi.object({
        summaryId: Joi.string().required(),
    }),
};

exports.getDailyEntries = {
    params: Joi.object({
        summaryId: Joi.string().required(),
    }),
};

exports.getDailySummaryReport = {
    params: Joi.object({
        summaryId: Joi.string().required(),
    }),
};