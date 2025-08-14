const mongoose = require('mongoose');

const saleTransactionSchema = new mongoose.Schema({
    dailySummaryId: { type: mongoose.Schema.Types.ObjectId, ref: 'DailySummary', required: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plant', required: true },
    cashierId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    transactionType: { type: String, enum: ['POS', 'CASH', 'TRANSFER'], required: true },
    amount: { type: Number, required: true, min: 0 },
    kgSold: { type: Number, required: true, min: 0 },
    pricePerKg: { type: Number, required: true, min: 0.01 },
    isReconciled: { type: Boolean, default: false },
}, { timestamps: true });

const SaleTransaction = mongoose.model('SaleTransaction', saleTransactionSchema);
module.exports = SaleTransaction;