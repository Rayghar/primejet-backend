const DailySummary = require('../../../models/dailySummary.model'); // Correct path
const SaleTransaction = require('../../../models/saleTransaction.model'); // Correct path

const getManagerSalesView = async (req, res, next) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const startOfWeek = new Date();
        startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
        startOfWeek.setHours(0, 0, 0, 0);

        const dailySummary = await DailySummary.find({ date: { $gte: today } });
        const weeklySummary = await DailySummary.find({ date: { $gte: startOfWeek } });

        const dailyTotals = dailySummary.reduce((acc, summary) => {
            acc.posAmount += summary.sales.posAmount;
            acc.cashAmount += summary.sales.cashAmount;
            acc.transferAmount += summary.sales.transferAmount;
            return acc;
        }, { posAmount: 0, cashAmount: 0, transferAmount: 0 });

        const weeklyTotals = weeklySummary.reduce((acc, summary) => {
            acc.posAmount += summary.sales.posAmount;
            acc.cashAmount += summary.sales.cashAmount;
            acc.transferAmount += summary.sales.transferAmount;
            return acc;
        }, { posAmount: 0, cashAmount: 0, transferAmount: 0 });
        
        // This is a placeholder for the future feature to mark cash paid to the bank
        const cumulativeSales = await DailySummary.aggregate([
            { $group: { _id: null, posAmount: { $sum: '$sales.posAmount' }, cashAmount: { $sum: '$sales.cashAmount' }, transferAmount: { $sum: '$sales.transferAmount' } } }
        ]);

        res.status(200).json({
            daily: dailyTotals,
            weekly: weeklyTotals,
            cumulative: cumulativeSales[0]
        });
    } catch (error) {
        next(error);
    }
};

// Placeholder for the future feature to mark cash as paid to the bank
const markCashPaidToBank = async (req, res, next) => {
    try {
        const { summaryId } = req.params;
        const { amount, datePaid } = req.body;
        // Logic to update a ledger or transaction record
        res.status(200).json({ message: 'Cash marked as paid to bank.' });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getManagerSalesView,
    markCashPaidToBank
};