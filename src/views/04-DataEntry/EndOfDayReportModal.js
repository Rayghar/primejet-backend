// src/views/04-DataEntry/EndOfDayReportModal.js
import React, { useState, useEffect } from 'react';
import { getDailySummaryReport } from '../../api/dataEntryService';
import { formatDate, formatCurrency } from '../../utils/formatters';
import Modal from '../../components/shared/Modal';
import Button from '../../components/shared/Button';
import { Printer } from 'lucide-react';

export default function EndOfDayReportModal({ summaryId, onClose }) {
    const [reportData, setReportData] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchReportData = async () => {
            setLoading(true);
            try {
                const data = await getDailySummaryReport(summaryId);
                setReportData(data);
            } catch (error) {
                console.error('Failed to fetch report data:', error);
            } finally {
                setLoading(false);
            }
        };

        if (summaryId) fetchReportData();
        else {
            setLoading(false);
            setReportData(null);
        }
    }, [summaryId]);

    const handlePrint = () => {
        const printWindow = window.open('', '', 'height=600,width=800');
        printWindow.document.write('<html><head><title>Print Report</title>');
        printWindow.document.write('<style>');
        printWindow.document.write(`
            body { font-family: sans-serif; margin: 20px; }
            .report-header { text-align: center; margin-bottom: 20px; }
            .report-header h1 { font-size: 24px; margin-bottom: 5px; }
            .report-header h2 { font-size: 18px; margin-bottom: 10px; }
            .summary-section h3 { font-size: 16px; margin-top: 15px; margin-bottom: 10px; border-bottom: 1px solid #eee; padding-bottom: 5px; }
            .summary-section p { margin-bottom: 5px; }
            .summary-section hr { border: 0; border-top: 1px dashed #ccc; margin: 10px 0; }
            .total-line { font-weight: bold; }
            @media print { .no-print { display: none !important; } }
        `);
        printWindow.document.write('</style></head><body>');

        const reportContent = `
            <div class="report-header">
                <h1>PrimeJet Gas LLC</h1>
                <h2>End-of-Day Summary</h2>
                <p>Date: ${formatDate(reportData.summary.date)}</p>
                <p>Branch: ${reportData.summary.branchId}</p>
                <p>Cashier: ${reportData.summary.cashierName || 'N/A'}</p>
            </div>
            <hr />
            <div class="summary-section">
                <h3>Summary</h3>
                <p>Total Revenue: <strong class="float-right">${formatCurrency(reportData.totals.totalRevenue)}</strong></p>
                <p>Total LPG Sold: <strong class="float-right">${reportData.totals.totalKgSold.toLocaleString()} kg</strong></p>
                <p>Total Expenses: <strong class="float-right">${formatCurrency(reportData.totals.totalExpenses)}</strong></p>
            </div>
            <hr />
            <div class="summary-section">
                <h3>Sales Details</h3>
                ${reportData.sales.map(s => `<p>${s.kgSold} kg (${s.transactionType}) - <span class="float-right">${formatCurrency(s.amount)}</span></p>`).join('') || '<p>No sales recorded.</p>'}
            </div>
            <hr />
            <div class="summary-section">
                <h3>Expense Details</h3>
                ${reportData.expenses.map(e => `<p>${e.description} (${e.category}) - <span class="float-right">${formatCurrency(e.amount)}</span></p>`).join('') || '<p>No expenses recorded.</p>'}
            </div>
            <hr />
            <div class="summary-section">
                <h3>Meter Readings</h3>
                <p>Opening Meter A: <span class="float-right">${reportData.summary.openingMeters.meterA || 0} kg</span></p>
                <p>Closing Meter A: <span class="float-right">${reportData.summary.closingMeters.meterA || 0} kg</span></p>
                <p>Opening Meter B: <span class="float-right">${reportData.summary.openingMeters.meterB || 0} kg</span></p>
                <p>Closing Meter B: <span class="float-right">${reportData.summary.closingMeters.meterB || 0} kg</span></p>
                <p>Price Per Kg: <span class="float-right">${formatCurrency(reportData.summary.pricePerKg)}</span></p>
            </div>
        `;
        printWindow.document.write(reportContent);
        printWindow.document.write('</body></html>');
        printWindow.document.close();
        printWindow.focus();
        printWindow.print();
        printWindow.close();
    };

    return (
        <Modal title={`End-of-Day Report for ${formatDate(reportData?.summary?.date || new Date())}`} onClose={onClose}>
            {loading ? (
                <p className="text-center p-8">Generating report...</p>
            ) : reportData ? (
                <div>
                    <div id="report-content">
                        <div className="report-header">
                            <h1>PrimeJet Gas LLC</h1>
                            <h2>End-of-Day Summary</h2>
                            <p>Date: {formatDate(reportData.summary.date)}</p>
                            <p>Branch: {reportData.summary.branchId}</p>
                            <p>Cashier: {reportData.summary.cashierName || 'N/A'}</p>
                        </div>
                        <hr />
                        <div className="summary-section">
                            <h3>Summary</h3>
                            <p>Total Revenue: <strong className="float-right">{formatCurrency(reportData.totals.totalRevenue)}</strong></p>
                            <p>Total LPG Sold: <strong className="float-right">{reportData.totals.totalKgSold.toLocaleString()} kg</strong></p>
                            <p>Total Expenses: <strong className="float-right">{formatCurrency(reportData.totals.totalExpenses)}</strong></p>
                        </div>
                        <hr />
                        <div className="summary-section">
                            <h3>Sales Details</h3>
                            {reportData.sales.length > 0 ? reportData.sales.map((s, i) => (
                                <p key={`sale-${s._id || i}`}>{s.kgSold} kg ({s.transactionType}) - <span className="float-right">{formatCurrency(s.amount)}</span></p>
                            )) : <p>No sales recorded.</p>}
                        </div>
                        <hr />
                        <div className="summary-section">
                            <h3>Expense Details</h3>
                            {reportData.expenses.length > 0 ? reportData.expenses.map((e, i) => (
                                <p key={`exp-${e._id || i}`}>{e.description} ({e.category}) - <span className="float-right">{formatCurrency(e.amount)}</span></p>
                            )) : <p>No expenses recorded.</p>}
                        </div>
                        <hr />
                        <div className="summary-section">
                            <h3>Meter Readings</h3>
                            <p>Opening Meter A: <span className="float-right">{reportData.summary.openingMeters.meterA || 0} kg</span></p>
                            <p>Closing Meter A: <span className="float-right">{reportData.summary.closingMeters.meterA || 0} kg</span></p>
                            <p>Opening Meter B: <span className="float-right">{reportData.summary.openingMeters.meterB || 0} kg</span></p>
                            <p>Closing Meter B: <span className="float-right">{reportData.summary.closingMeters.meterB || 0} kg</span></p>
                            <p>Price Per Kg: <span className="float-right">{formatCurrency(reportData.summary.pricePerKg)}</span></p>
                        </div>
                    </div>
                    <div className="flex justify-end pt-4 no-print">
                        <Button onClick={handlePrint} icon={Printer}>Print Report</Button>
                    </div>
                </div>
            ) : (
                <p className="text-center p-8 text-gray-500">Could not generate report. Summary not found or data is incomplete.</p>
            )}
        </Modal>
    );
}