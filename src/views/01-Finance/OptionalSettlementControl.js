import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, RefreshCw, UploadCloud } from 'lucide-react';
import {
  confirmSettlement,
  getRevenueLeakageDashboard,
  getSettlementDashboard,
  getStatementUploads,
  settlementExportUrl,
  uploadManualStatementRows,
} from '../../api/financialService';

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
const money = (v) => `₦${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const safeNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

const statusClass = (status) => {
  const s = String(status || '').toUpperCase();
  if (s === 'FULLY_CONFIRMED' || s === 'RESOLVED') return 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20';
  if (s === 'VARIANCE_DETECTED' || s === 'ESCALATED') return 'text-amber-300 bg-amber-500/10 border-amber-500/20';
  if (s === 'PARTIALLY_CONFIRMED') return 'text-blue-300 bg-blue-500/10 border-blue-500/20';
  return 'text-slate-300 bg-slate-500/10 border-slate-500/20';
};

function StatCard({ label, value, helper }) {
  return (
    <div className="bg-slate-900/70 border border-white/10 rounded-2xl p-4">
      <p className="text-xs uppercase tracking-wider text-slate-400 font-semibold">{label}</p>
      <p className="text-2xl font-bold text-white mt-2">{value}</p>
      {helper ? <p className="text-xs text-slate-500 mt-1">{helper}</p> : null}
    </div>
  );
}

function SettlementInput({ method, selected, onSave, saving }) {
  const [actualAmount, setActualAmount] = useState('');
  const [reference, setReference] = useState('');
  const [varianceReason, setVarianceReason] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    const row = selected?.[method] || {};
    setActualAmount(row.actualAmount ?? '');
    setReference(row.reference || '');
    setVarianceReason(row.varianceReason || '');
    setNotes(row.notes || '');
  }, [method, selected?._id]);

  if (!selected) {
    return <div className="p-4 rounded-xl bg-slate-950/60 text-slate-400 border border-white/10">Select a daily close record to confirm settlement.</div>;
  }

  const expectedMap = {
    cash: selected?.expected?.expectedCashOnHand,
    transfer: selected?.expected?.transferSales,
    pos: selected?.expected?.posSales,
  };
  const labelMap = { cash: 'Cash counted', transfer: 'Bank transfer confirmed', pos: 'POS settlement confirmed' };
  const expected = safeNum(expectedMap[method]);
  const variance = expected - safeNum(actualAmount);

  return (
    <div className="bg-slate-950/50 border border-white/10 rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-white capitalize">{labelMap[method]}</h3>
          <p className="text-xs text-slate-400">Expected: {money(expected)} · Variance: {money(variance)}</p>
        </div>
        <span className={`px-2 py-1 rounded-lg text-xs border ${statusClass(selected?.[method]?.status)}`}>{selected?.[method]?.status || 'NOT_REVIEWED'}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="text-xs text-slate-300">Actual amount
          <input className="mt-1 w-full bg-slate-900 border border-white/10 rounded-xl p-2 text-white" type="number" value={actualAmount} onChange={(e) => setActualAmount(e.target.value)} />
        </label>
        <label className="text-xs text-slate-300">Reference / narration
          <input className="mt-1 w-full bg-slate-900 border border-white/10 rounded-xl p-2 text-white" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Bank ref, POS terminal, receipt ref" />
        </label>
      </div>
      <label className="text-xs text-slate-300 block">Variance reason
        <input className="mt-1 w-full bg-slate-900 border border-white/10 rounded-xl p-2 text-white" value={varianceReason} onChange={(e) => setVarianceReason(e.target.value)} placeholder="Required if there is a shortage/overage" />
      </label>
      <label className="text-xs text-slate-300 block">Confirmation note
        <textarea className="mt-1 w-full bg-slate-900 border border-white/10 rounded-xl p-2 text-white min-h-[72px]" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional finance note" />
      </label>
      <button
        onClick={() => onSave({ method, actualAmount, reference, varianceReason, notes })}
        disabled={saving || actualAmount === ''}
        className="w-full px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold"
      >
        Save {method.toUpperCase()} Confirmation
      </button>
    </div>
  );
}

export default function OptionalSettlementControl() {
  const [filters, setFilters] = useState({ startDate: monthStart(), endDate: today(), branchIdOrZoneId: '' });
  const [dashboard, setDashboard] = useState(null);
  const [leakage, setLeakage] = useState(null);
  const [uploads, setUploads] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [uploadForm, setUploadForm] = useState({ sourceType: 'BANK', uploadName: '', rawText: '' });

  const items = dashboard?.items || [];
  const selected = useMemo(() => items.find((x) => String(x._id) === String(selectedId)) || items[0] || null, [items, selectedId]);

  const load = async () => {
    setError('');
    setMessage('');
    try {
      const payload = {
        startDate: filters.startDate,
        endDate: filters.endDate,
        branchIdOrZoneId: filters.branchIdOrZoneId || undefined,
      };
      const [d, l, u] = await Promise.all([
        getSettlementDashboard(payload),
        getRevenueLeakageDashboard(payload),
        getStatementUploads({ branchIdOrZoneId: filters.branchIdOrZoneId || undefined, limit: 10 }),
      ]);
      setDashboard(d);
      setLeakage(l);
      setUploads(u?.items || []);
      if (!selectedId && d?.items?.[0]?._id) setSelectedId(String(d.items[0]._id));
    } catch (err) {
      setError(err?.message || 'Failed to load settlement controls.');
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveSettlement = async ({ method, actualAmount, reference, varianceReason, notes }) => {
    if (!selected) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await confirmSettlement({
        dailySummaryId: selected.dailySummaryId,
        settlementType: method.toUpperCase(),
        actualAmount,
        reference,
        varianceReason,
        notes,
      });
      setMessage(`${method.toUpperCase()} settlement saved. This optional control does not block posting.`);
      await load();
    } catch (err) {
      setError(err?.message || 'Failed to save settlement confirmation.');
    } finally {
      setSaving(false);
    }
  };

  const uploadStatement = async () => {
    if (!uploadForm.rawText.trim()) {
      setError('Paste CSV-style rows before uploading.');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const res = await uploadManualStatementRows({
        sourceType: uploadForm.sourceType,
        uploadName: uploadForm.uploadName,
        branchId: filters.branchIdOrZoneId || undefined,
        periodStart: filters.startDate,
        periodEnd: filters.endDate,
        rawText: uploadForm.rawText,
      });
      setMessage(`Statement upload saved: ${res?.item?.summary?.rowCount || 0} rows captured for review.`);
      setUploadForm({ sourceType: 'BANK', uploadName: '', rawText: '' });
      await load();
    } catch (err) {
      setError(err?.message || 'Failed to upload statement rows.');
    } finally {
      setSaving(false);
    }
  };

  const totals = dashboard?.totals || {};
  const indicators = leakage?.indicators || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Optional Settlement Control</h1>
          <p className="text-sm text-slate-400">Manual cash, transfer and POS settlement confirmation. Advisory only; it does not block POS, daily close, approval, GL posting or reports.</p>
        </div>
        <div className="flex gap-2">
          <a className="px-4 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-white flex items-center gap-2" href={settlementExportUrl(filters)}>
            <Download size={16} /> CSV
          </a>
          <button onClick={load} className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white flex items-center gap-2"><RefreshCw size={16} /> Refresh</button>
        </div>
      </div>

      <div className="rounded-2xl border border-blue-500/20 bg-blue-500/10 p-4 text-sm text-blue-100 flex gap-3">
        <CheckCircle2 size={20} className="text-blue-300 mt-0.5" />
        <div>
          <p className="font-semibold">Optional control enabled</p>
          <p className="text-blue-100/80">Settlement review supports finance assurance now, while bank/POS/payment gateway API integrations remain deferred to Wave 11B.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-slate-900/60 border border-white/10 rounded-2xl p-4">
        <label className="text-sm text-slate-300">Start<input className="mt-1 w-full bg-slate-950 border border-white/10 rounded-xl p-2" type="date" value={filters.startDate} onChange={(e) => setFilters({ ...filters, startDate: e.target.value })} /></label>
        <label className="text-sm text-slate-300">End<input className="mt-1 w-full bg-slate-950 border border-white/10 rounded-xl p-2" type="date" value={filters.endDate} onChange={(e) => setFilters({ ...filters, endDate: e.target.value })} /></label>
        <label className="text-sm text-slate-300">Branch / Plant ID<input className="mt-1 w-full bg-slate-950 border border-white/10 rounded-xl p-2" value={filters.branchIdOrZoneId} onChange={(e) => setFilters({ ...filters, branchIdOrZoneId: e.target.value })} /></label>
        <div className="flex items-end"><button onClick={load} className="w-full px-4 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-white">Apply</button></div>
      </div>

      {error ? <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-red-200">{error}</div> : null}
      {message ? <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-emerald-200">{message}</div> : null}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard label="Daily closes reviewed" value={dashboard?.count || 0} helper="All statuses are advisory" />
        <StatCard label="Cash variance" value={money(totals.cashVariance)} helper={`${money(totals.expectedCash)} expected`} />
        <StatCard label="Transfer variance" value={money(totals.transferVariance)} helper={`${money(totals.expectedTransfer)} expected`} />
        <StatCard label="POS variance" value={money(totals.posVariance)} helper={`${money(totals.expectedPos)} expected`} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 bg-slate-900/70 border border-white/10 rounded-2xl p-4 overflow-x-auto">
          <h2 className="font-bold text-white mb-3">Daily Close Settlement Status</h2>
          <table className="w-full text-sm">
            <thead className="text-slate-400 border-b border-white/10"><tr><th className="p-2 text-left">Date</th><th className="p-2 text-left">Cashier</th><th className="p-2 text-right">Expected Cash</th><th className="p-2 text-right">Transfer</th><th className="p-2 text-right">POS</th><th className="p-2 text-left">Status</th></tr></thead>
            <tbody>
              {items.map((r) => (
                <tr key={r._id} onClick={() => setSelectedId(String(r._id))} className={`border-t border-white/5 cursor-pointer hover:bg-white/5 ${String(selected?._id) === String(r._id) ? 'bg-blue-500/10' : ''}`}>
                  <td className="p-2 text-slate-200">{String(r.businessDate || '').slice(0, 10)}</td>
                  <td className="p-2 text-slate-200">{r.cashierName || '—'}</td>
                  <td className="p-2 text-right text-slate-200">{money(r.expected?.expectedCashOnHand)}</td>
                  <td className="p-2 text-right text-slate-200">{money(r.expected?.transferSales)}</td>
                  <td className="p-2 text-right text-slate-200">{money(r.expected?.posSales)}</td>
                  <td className="p-2"><span className={`px-2 py-1 rounded-lg text-xs border ${statusClass(r.settlementStatus)}`}>{r.settlementStatus}</span></td>
                </tr>
              ))}
              {items.length === 0 ? <tr><td colSpan={6} className="p-8 text-center text-slate-500">No daily close records found for the selected period.</td></tr> : null}
            </tbody>
          </table>
        </div>

        <div className="space-y-4">
          <SettlementInput method="cash" selected={selected} onSave={saveSettlement} saving={saving} />
          <SettlementInput method="transfer" selected={selected} onSave={saveSettlement} saving={saving} />
          <SettlementInput method="pos" selected={selected} onSave={saveSettlement} saving={saving} />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="bg-slate-900/70 border border-white/10 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3"><AlertTriangle size={18} className="text-amber-300" /><h2 className="font-bold text-white">Revenue Leakage Indicators</h2></div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {indicators.map((x) => (
              <div key={x.key} className="bg-slate-950/60 border border-white/10 rounded-xl p-3">
                <div className="flex justify-between gap-2"><span className="text-sm text-slate-300">{x.label}</span><span className="font-bold text-white">{x.count}</span></div>
                <p className={`text-xs mt-1 ${x.severity === 'OK' ? 'text-emerald-300' : x.severity === 'CRITICAL' ? 'text-red-300' : 'text-amber-300'}`}>{x.severity}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500 mt-3">Wallet liability estimate: {money(leakage?.walletLiabilityEstimate)}. This is not auto-posted to GL in Wave 11A.</p>
        </div>

        <div className="bg-slate-900/70 border border-white/10 rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-2"><UploadCloud size={18} className="text-blue-300" /><h2 className="font-bold text-white">Manual Statement Upload Foundation</h2></div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-xs text-slate-300">Source
              <select className="mt-1 w-full bg-slate-950 border border-white/10 rounded-xl p-2" value={uploadForm.sourceType} onChange={(e) => setUploadForm({ ...uploadForm, sourceType: e.target.value })}>
                <option>BANK</option><option>POS</option><option>PAYSTACK</option><option>MONNIFY</option><option>OTHER</option>
              </select>
            </label>
            <label className="text-xs text-slate-300">Upload name
              <input className="mt-1 w-full bg-slate-950 border border-white/10 rounded-xl p-2" value={uploadForm.uploadName} onChange={(e) => setUploadForm({ ...uploadForm, uploadName: e.target.value })} placeholder="April POS settlement" />
            </label>
          </div>
          <label className="text-xs text-slate-300 block">CSV-style rows
            <textarea className="mt-1 w-full bg-slate-950 border border-white/10 rounded-xl p-2 min-h-[140px] text-white" value={uploadForm.rawText} onChange={(e) => setUploadForm({ ...uploadForm, rawText: e.target.value })} placeholder={'date,reference,narration,amount,credit,debit\n2026-04-01,REF123,POS settlement,50000,50000,0'} />
          </label>
          <button onClick={uploadStatement} disabled={saving} className="w-full px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold">Save Upload for Review</button>

          <div className="pt-3 border-t border-white/10">
            <h3 className="text-sm font-semibold text-white mb-2">Recent uploads</h3>
            {uploads.map((u) => (
              <div key={u._id} className="flex justify-between text-xs py-2 border-t border-white/5 text-slate-300">
                <span>{u.uploadName || u.sourceType}</span>
                <span>{u.summary?.rowCount || 0} rows · {u.summary?.unmatchedCount || 0} unmatched</span>
              </div>
            ))}
            {uploads.length === 0 ? <p className="text-xs text-slate-500">No statement uploads yet.</p> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
