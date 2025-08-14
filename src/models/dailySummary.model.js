const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid'); // Import uuidv4 for default summaryId

const dailySummarySchema = new mongoose.Schema({
    summaryId: { 
        type: String, 
        unique: true, 
        required: true, 
        default: uuidv4 // Automatically generate a unique ID
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
        meterA: { type: Number, required: true },
        meterB: { type: Number, default: 0 }
    },
    closingMeters: {
        meterA: { type: Number, required: true },
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
        }] // Reference to SaleTransaction model
    },
    expenses: {
        total: { type: Number, default: 0 },
        items: [{ 
            type: mongoose.Schema.Types.ObjectId, 
            ref: 'ExpenseTransaction' 
        }] // Reference to ExpenseTransaction model
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
    timestamps: true,
    // Optionally drop the problematic id_1 index if it exists
    // Note: This requires a migration or manual index drop in MongoDB if already applied
});

const DailySummary = mongoose.model('DailySummary', dailySummarySchema);
module.exports = DailySummary;

// Migration note (to be executed separately if needed):
// db.dailysummaries.dropIndex({ "id": 1 }); // Drop the id_1 index if it exists
// This should be done via a MongoDB shell or migration script after schema update