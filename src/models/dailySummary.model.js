// src/models/dailySummary.model.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const dailySummarySchema = new mongoose.Schema({
    // The default _id field is sufficient. We will use `summaryId` for human-readable ID.
    summaryId: { 
        type: String, 
        unique: true, 
        required: true, 
        default: uuidv4, // Automatically generate a unique ID
    },
    date: { type: Date, required: true },
    branchId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Plant', 
        required: true 
    },
    cashierName: { 
        type: String, 
        required: true, 
        minlength: 3, 
        maxlength: 100 
    },
    status: { 
        type: String, 
        enum: ['in_progress', 'pending_approval', 'approved', 'rejected'],
        default: 'in_progress'
    },
    openingMeters: {
        meterA: { type: Number, required: true, default: 0 },
        meterB: { type: Number, default: 0 }
    },
    closingMeters: {
        meterA: { type: Number, required: true, default: 0 },
        meterB: { type: Number, default: 0 }
    },
    sales: {
        totalKgSold: { type: Number, default: 0 },
        calculatedRevenue: { type: Number, default: 0 },
        posAmount: { type: Number, default: 0 },
        cashAmount: { type: Number, default: 0 },
        transferAmount: { type: Number, default: 0 },
        totalRevenue: { type: Number, default: 0 },
        items: [{ 
            type: mongoose.Schema.Types.ObjectId, 
            ref: 'SaleTransaction' 
        }]
    },
    expenses: {
        total: { type: Number, default: 0 },
        items: [{ 
            type: mongoose.Schema.Types.ObjectId, 
            ref: 'ExpenseTransaction' 
        }]
    },
    reconciliation: {
        discrepancy: { type: Number, default: 0 }
    },
    pricePerKg: { 
        type: Number, 
        required: true, 
        min: 0.01 
    },
    managerApproval: {
        approvedBy: { 
            type: mongoose.Schema.Types.ObjectId, 
            ref: 'User', 
            default: null 
        },
        approvalDate: { 
            type: Date, 
            default: null 
        },
        isApproved: { 
            type: Boolean, 
            default: false 
        },
        rejectionReason: { 
            type: String, 
            default: null 
        }
    },
}, { 
    timestamps: true
});

// We should handle the case where 'id_1' index exists and drops it.
// This is a one-time migration step.
dailySummarySchema.index({ summaryId: 1 }, { unique: true });

const DailySummary = mongoose.model('DailySummary', dailySummarySchema);
module.exports = DailySummary;