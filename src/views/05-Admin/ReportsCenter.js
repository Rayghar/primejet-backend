import React, { useState } from 'react';
import apiClient from '../../api/apiClient';
import PageTitle from '../../components/shared/PageTitle';
import Card from '../../components/shared/Card';
import Button from '../../components/shared/Button';
import { FileText, Download, Calendar, Filter } from 'lucide-react';

const REPORT_TYPES = [
    { id: 'financials', name: 'Management Accounts (P&L, Balance Sheet)', endpoint: '/api/v2/financials/export' },
    { id: 'sales', name: 'Detailed Sales Ledger', endpoint: '/api/v2/analytics/sales/export' },
    { id: 'inventory', name: 'Stock Valuation & Movement', endpoint: '/api/v2/inventory/export' },
    { id: 'audit', name: 'System Security Audit Log', endpoint: '/api/v2/logs/export' },
    { id: 'debtors', name: 'Aged Receivables (Debtors)', endpoint: '/api/v2/financials/debtors/export' },
];

export default function ReportsCenter() {
    const [selectedReport, setSelectedReport] = useState(REPORT_TYPES[0]);
    const [dateRange, setDateRange] = useState({ start: '', end: '' });
    const [loading, setLoading] = useState(false);

    const handleExport = async (format) => {
        if (!dateRange.start || !dateRange.end) return alert("Please select a date range.");
        setLoading(true);
        try {
            // Trigger File Download
            const response = await apiClient.get(selectedReport.endpoint, {
                params: { ...dateRange, format },
                responseType: 'blob' // Important for file download
            });
            
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `${selectedReport.id}_report_${new Date().toISOString()}.csv`);
            document.body.appendChild(link);
            link.click();
            link.remove();
        } catch (e) {
            console.error(e);
            alert("Export failed. Ensure data exists for this range.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-6">
            <PageTitle title="Reports Center" subtitle="Audit-ready exports for Banks & Stakeholders" />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Configuration Panel */}
                <div className="glass-card h-fit">
                    <h3 className="text-white font-bold mb-4 flex items-center">
                        <Filter size={18} className="mr-2 text-blue-400"/> Report Configuration
                    </h3>
                    
                    <div className="space-y-4">
                        <div>
                            <label className="block text-gray-400 text-xs mb-1">Report Type</label>
                            <select 
                                className="glass-input w-full p-3 bg-slate-800"
                                onChange={(e) => setSelectedReport(REPORT_TYPES.find(r => r.id === e.target.value))}
                            >
                                {REPORT_TYPES.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                            </select>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className="block text-gray-400 text-xs mb-1">Start Date</label>
                                <input type="date" className="glass-input w-full p-2" onChange={e => setDateRange({...dateRange, start: e.target.value})} />
                            </div>
                            <div>
                                <label className="block text-gray-400 text-xs mb-1">End Date</label>
                                <input type="date" className="glass-input w-full p-2" onChange={e => setDateRange({...dateRange, end: e.target.value})} />
                            </div>
                        </div>

                        <div className="pt-4 border-t border-white/10 flex gap-2">
                            <Button className="flex-1 bg-green-600 hover:bg-green-500" onClick={() => handleExport('csv')} disabled={loading}>
                                <Download size={16} className="mr-2"/> Export CSV
                            </Button>
                            <Button className="flex-1 bg-white/10 hover:bg-white/20" onClick={() => handleExport('pdf')} disabled={loading}>
                                <FileText size={16} className="mr-2"/> PDF
                            </Button>
                        </div>
                    </div>
                </div>

                {/* Preview / Context Panel */}
                <div className="lg:col-span-2 glass-card flex flex-col items-center justify-center text-center p-12 border-dashed border-2 border-white/10">
                    <div className="p-6 bg-blue-500/10 rounded-full mb-4">
                        <FileText size={48} className="text-blue-400" />
                    </div>
                    <h2 className="text-xl font-bold text-white">Generate Professional Reports</h2>
                    <p className="text-gray-400 max-w-md mt-2">
                        Select a report type and date range to generate GAAP-compliant financial statements or detailed transaction logs compatible with Excel and Sage/Quickbooks.
                    </p>
                </div>
            </div>
        </div>
    );
}