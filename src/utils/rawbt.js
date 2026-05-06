// src/utils/rawbt.js

const money = (v) => Number(v || 0).toLocaleString();

/**
 * Generates a receipt string in the RawBT command format.
 * Defensive by design: accepts either the new API envelope ({ transaction })
 * or a direct SaleTransaction object, and supports amount/totalRevenue/revenue.
 */
export const generateRawBtReceipt = (saleData = {}, companyInfo = {}) => {
    const sale = saleData.transaction || saleData.sale || saleData.entry || saleData || {};
    const now = new Date(sale.createdAt || sale.date || Date.now());
    const formattedDate = now.toLocaleDateString('en-GB');
    const formattedTime = now.toLocaleTimeString('en-US', { hour12: true });
    const amount = Number(sale.amount ?? sale.totalRevenue ?? sale.revenue ?? 0);
    const kgSold = Number(sale.kgSold ?? sale.quantity ?? 0);
    const receiptNumber = sale.receiptNumber || (sale._id ? `SALE-${String(sale._id).slice(-8).toUpperCase()}` : 'N/A');
    const cashier = sale.cashierEmail || sale.cashierName || sale.cashierId || 'N/A';
    const paymentMethod = sale.paymentMethod || sale.transactionType || 'Cash';

    let receipt = '';
    receipt += '[C]<b><H2>SALES RECEIPT</H2></b>\n';
    receipt += `[C]<b>${companyInfo.name || 'PrimeJet'}</b>\n`;
    receipt += `[C]${companyInfo.address || 'Lagos'}\n`;
    if (companyInfo.phone) receipt += `[C]Phone: ${companyInfo.phone}\n`;
    receipt += '[C]================================\n';
    receipt += `[L]Receipt No: [R]${receiptNumber}\n`;
    receipt += `[L]Date: ${formattedDate} [R]Time: ${formattedTime}\n`;
    receipt += `[L]Cashier: [R]${cashier}\n`;
    receipt += '[C]--------------------------------\n';
    receipt += '[L]<b>ITEM</b>[R]<b>AMOUNT</b>\n';
    receipt += `[L]LPG Gas (${kgSold.toLocaleString()} kg)[R]${money(amount)}\n`;
    receipt += '[C]--------------------------------\n';
    receipt += `[L]<b><H2>TOTAL</H2></b>[R]<b><H2>NGN ${money(amount)}</H2></b>\n`;
    receipt += '[C]================================\n';
    receipt += `[C]Payment Method: ${paymentMethod}\n\n`;
    receipt += '[C]Thank you for your patronage!\n';
    if (companyInfo.website) receipt += `[C]<qrcode>${companyInfo.website}</qrcode>\n`;
    receipt += '\n\n';

    return receipt;
};

export const createRawBtLink = (receiptText) => {
    const base64String = btoa(receiptText || '');
    return `rawbt:${base64String}`;
};
