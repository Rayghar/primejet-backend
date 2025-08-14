const mongoose = require('mongoose');

const expenseTransactionSchema = new mongoose.Schema({
    dailySummaryId: { type: mongoose.Schema.Types.ObjectId, ref: 'DailySummary', required: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plant', required: true },
    cashierId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    description: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    isReconciled: { type: Boolean, default: false },
}, { timestamps: true });

const ExpenseTransaction = mongoose.model('ExpenseTransaction', expenseTransactionSchema);
module.exports = ExpenseTransaction;