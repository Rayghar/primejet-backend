// src/views/03-Finance/TaxCompliance.js
import React, { useEffect, useMemo, useState } from 'react';
import { getTaxComplianceReport } from '../../api/financialService';
import { getPlants } from '../../api/operationsService';
import PageTitle from '../../components/shared/PageTitle';
import Card from '../../components/shared/Card';
import Button from '../../components/shared/Button';
import { formatCurrency } from '../../utils/formatters';
import { Landmark, FileCheck, RefreshCw, AlertTriangle } from 'lucide-react';

export default function TaxCompliance() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState('');
  const [error, setError] = useState('');

  const safeNumber = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const fetchBranches = async () => {
    try {
      const plants = await getPlants();
      const normalized = Array.isArray(plants)
        ? plants
            .map((p) => ({
              id: p?.id || p?._id,
              name: p?.name || 'Unnamed Branch',
            }))
            .filter((x) => x.id)
        : [];
      setBranches(normalized);
    } catch (e) {
      console.error('Failed to load branches:', e);
      setBranches([]);
    }
  };

  const fetchTaxReport = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getTaxComplianceReport(branchId || undefined);
      setReport(data || {});
    } catch (e) {
      console.error('Failed to load tax report:', e);
      setReport(null);
      setError(e?.message || 'Failed to load tax compliance report.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBranches();
  }, []);

  useEffect(() => {
    fetchTaxReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  const periodStart = useMemo(() => {
    const d = report?.period?.start ? new Date(report.period.start) : null;
    return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString() : null;
  }, [report]);

  const periodEnd = useMemo(() => {
    const d = report?.period?.end ? new Date(report.period.end) : null;
    return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString() : null;
  }, [report]);

  const vatPayable = safeNumber(report?.vatPayable);
  const taxableRevenue = safeNumber(report?.taxableRevenue);
  const totalExpenses = safeNumber(report?.totalExpenses);
  const withholdingTax = safeNumber(report?.withholdingTaxPayable || report?.whtPayable || 0);
  const levyPayable = safeNumber(report?.levyPayable || 0);

  const totalRegulatoryPayable = vatPayable + withholdingTax + levyPayable;

  const dueDateText = report?.filingDueDate || '—';
  const citStatus = report?.citStatus || 'Pioneer Status Active';

  const isDueSoon = (() => {
    if (!report?.filingDueDate) return false;
    const due = new Date(report.filingDueDate);
    if (Number.isNaN(due.getTime())) return false;
    const days = (due.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    return days >= 0 && days <= 7;
  })();

  if (loading) return <div className="p-8 text-center text-blue-400 animate-pulse">Loading Tax Data...</div>;

  if (!report && error) {
    return (
      <div className="space-y-6">
        <PageTitle title="Tax Compliance" subtitle="VAT & Regulatory Reporting" />
        <Card className="glass-card p-8 text-center">
          <div className="text-red-300">{error}</div>
          <div className="mt-4">
            <Button variant="secondary" icon={RefreshCw} onClick={fetchTaxReport}>
              Retry
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <PageTitle title="Tax Compliance" subtitle="VAT & Regulatory Reporting" />
        <div className="print:hidden">
          <Button size="sm" variant="secondary" icon={RefreshCw} onClick={fetchTaxReport} disabled={loading}>
            Refresh
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="glass-card p-4 print:hidden">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1 min-w-[220px]">
            <label className="text-xs text-gray-400">Branch</label>
            <select
              className="px-3 py-2 rounded-lg bg-black/30 text-white border border-white/10"
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
            >
              <option value="">All Branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-gray-500">branchId == serviceZoneId</p>
          </div>

          {error ? (
            <div className="ml-auto text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </div>
          ) : null}
        </div>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="glass-card bg-blue-600/10 border border-blue-500/30">
          <div className="flex items-center mb-4">
            <div className="p-3 bg-blue-500/20 rounded-full mr-3">
              <Landmark className="text-blue-400" />
            </div>
            <div>
              <p className="text-xs text-blue-300 uppercase font-bold">VAT Output Payable</p>
              <p className="text-3xl font-bold text-white">{formatCurrency(vatPayable)}</p>
            </div>
          </div>

          <p className="text-sm text-gray-400">Taxable revenue: {formatCurrency(taxableRevenue)} @ 7.5%</p>

          {periodStart && periodEnd && (
            <p className="text-[11px] text-gray-500 mt-2">
              Period: {periodStart} – {periodEnd}
            </p>
          )}
        </Card>

        <Card className="glass-card">
          <h3 className="font-bold text-white mb-4">Compliance Status</h3>
          <div
            className={`flex items-center p-3 rounded-lg border ${
              isDueSoon
                ? 'bg-yellow-500/10 border-yellow-500/20'
                : 'bg-green-500/10 border-green-500/20'
            }`}
          >
            {isDueSoon ? (
              <AlertTriangle className="text-yellow-400 mr-3" />
            ) : (
              <FileCheck className="text-green-400 mr-3" />
            )}

            <div>
              <p className={`font-bold text-sm ${isDueSoon ? 'text-yellow-300' : 'text-green-300'}`}>{citStatus}</p>
              <p className="text-xs text-gray-400">Filing due: {dueDateText}</p>
            </div>
          </div>

          <div className="mt-4 text-xs text-gray-400">
            Total expenses (period): <span className="text-white">{formatCurrency(totalExpenses)}</span>
          </div>
        </Card>

        <Card className="glass-card">
          <h3 className="font-bold text-white mb-4">Regulatory Summary</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">VAT</span>
              <span className="text-white">{formatCurrency(vatPayable)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Withholding Tax</span>
              <span className="text-white">{formatCurrency(withholdingTax)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Levies</span>
              <span className="text-white">{formatCurrency(levyPayable)}</span>
            </div>
            <div className="pt-2 mt-2 border-t border-white/10 flex justify-between font-semibold">
              <span className="text-gray-300">Total Payable</span>
              <span className="text-blue-300">{formatCurrency(totalRegulatoryPayable)}</span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
