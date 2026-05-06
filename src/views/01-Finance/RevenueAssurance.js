// File: src/views/03-Finance/RevenueAssurance.js
import React, { useEffect, useMemo, useState } from 'react';
import { getRevenueAssuranceReport } from '../../api/financialService';
import { getPlants } from '../../api/operationsService';
import PageTitle from '../../components/shared/PageTitle';
import Card from '../../components/shared/Card';
import Button from '../../components/shared/Button';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { ShieldCheck, AlertTriangle, RefreshCw } from 'lucide-react';

export default function RevenueAssurance() {
  const [report, setReport] = useState([]);
  const [loading, setLoading] = useState(true);
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState('');
  const [error, setError] = useState('');

  const safeNumber = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

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

  const fetchReport = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getRevenueAssuranceReport(branchId || undefined);
      setReport(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Revenue assurance fetch failed:', e);
      setReport([]);
      setError(e?.message || 'Failed to load revenue assurance report.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBranches();
  }, []);

  useEffect(() => {
    fetchReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  const summary = useMemo(() => {
    const totalExpected = report.reduce((s, r) => s + safeNumber(r?.expectedRevenue), 0);
    const totalInvoiced = report.reduce((s, r) => s + safeNumber(r?.actualInvoicedRevenue), 0);
    const totalRecognized = report.reduce((s, r) => s + safeNumber(r?.actualRecognizedRevenue), 0);
    const totalDiscrepancy = report.reduce((s, r) => s + safeNumber(r?.discrepancyRecognizedVsExpected), 0);

    const flaggedCount = report.filter((batch) => safeNumber(batch?.integrityScore) < 95).length;

    return {
      totalExpected,
      totalInvoiced,
      totalRecognized,
      totalDiscrepancy,
      flaggedCount,
      totalBatches: report.length,
    };
  }, [report]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <PageTitle title="Revenue Assurance" subtitle="Stock batches vs recognized delivery revenue (GL-aligned logic)" />
        <div className="flex gap-2">
          <Button variant="secondary" icon={RefreshCw} onClick={fetchReport}>
            Refresh
          </Button>
        </div>
      </div>

      <Card className="bg-white/5 border border-white/10 rounded-xl p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
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
          </div>

          <div className="ml-auto text-xs text-gray-400">
            Integrity flags: <span className="text-white">{summary.flaggedCount}</span> /{' '}
            <span className="text-white">{summary.totalBatches}</span>
          </div>
        </div>
      </Card>

      {loading ? (
        <div className="p-10 text-center text-blue-400 animate-pulse">Loading revenue assurance...</div>
      ) : error ? (
        <div className="p-10 text-center text-gray-400">{error}</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="bg-white/5 border border-white/10 rounded-xl p-4">
              <div className="text-xs text-gray-400 uppercase font-semibold">Expected</div>
              <div className="text-white text-xl font-bold mt-2">{formatCurrency(summary.totalExpected)}</div>
            </Card>
            <Card className="bg-white/5 border border-white/10 rounded-xl p-4">
              <div className="text-xs text-gray-400 uppercase font-semibold">Invoiced</div>
              <div className="text-white text-xl font-bold mt-2">{formatCurrency(summary.totalInvoiced)}</div>
            </Card>
            <Card className="bg-white/5 border border-white/10 rounded-xl p-4">
              <div className="text-xs text-gray-400 uppercase font-semibold">Recognized</div>
              <div className="text-white text-xl font-bold mt-2">{formatCurrency(summary.totalRecognized)}</div>
            </Card>
            <Card className="bg-white/5 border border-white/10 rounded-xl p-4">
              <div className="text-xs text-gray-400 uppercase font-semibold">Δ Recognized vs Expected</div>
              <div className="text-white text-xl font-bold mt-2">{formatCurrency(summary.totalDiscrepancy)}</div>
            </Card>
          </div>

          <Card className="bg-white/5 border border-white/10 rounded-xl p-4 overflow-x-auto">
            <div className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
              <ShieldCheck size={16} className="text-emerald-300" />
              Batch Integrity Report
            </div>

            <table className="w-full text-sm">
              <thead className="border-b border-white/10 text-gray-300">
                <tr>
                  <th className="text-left py-2">Date</th>
                  <th className="text-left py-2">Supplier</th>
                  <th className="text-right py-2">Qty (kg)</th>
                  <th className="text-right py-2">Expected</th>
                  <th className="text-right py-2">Recognized</th>
                  <th className="text-right py-2">Integrity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {report.map((r) => {
                  const integrity = safeNumber(r.integrityScore);
                  const warn = integrity < 95;
                  return (
                    <tr key={String(r.batchId || r._id)}>
                      <td className="py-2 text-gray-200">{formatDate(r.date)}</td>
                      <td className="py-2 text-gray-200">{r.supplier || '—'}</td>
                      <td className="py-2 text-right text-gray-200">{safeNumber(r.quantityKg).toLocaleString()}</td>
                      <td className="py-2 text-right text-gray-200">{formatCurrency(r.expectedRevenue)}</td>
                      <td className="py-2 text-right text-white font-semibold">{formatCurrency(r.actualRecognizedRevenue)}</td>
                      <td className="py-2 text-right">
                        <span className={`text-xs ${warn ? 'text-amber-300' : 'text-emerald-300'}`}>
                          {warn ? <AlertTriangle size={14} className="inline mr-1" /> : null}
                          {integrity}%
                        </span>
                      </td>
                    </tr>
                  );
                })}

                {report.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-gray-500">
                      No batches found.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}