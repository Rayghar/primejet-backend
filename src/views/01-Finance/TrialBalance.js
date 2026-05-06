// File: src/views/03-Finance/TrialBalance.js
import React, { useEffect, useMemo, useState } from 'react';
import PageTitle from '../../components/shared/PageTitle';
import Card from '../../components/shared/Card';
import Button from '../../components/shared/Button';
import { getPlants } from '../../api/operationsService';
import { glTrialBalance } from '../../api/glService';
import { RefreshCw, Download, CheckCircle2, AlertTriangle } from 'lucide-react';

const safeNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const toCsv = (rows = []) => {
  const header = ['accountCode', 'name', 'type', 'normalBalance', 'debit', 'credit', 'balance'];
  const lines = [
    header.join(','),
    ...rows.map((r) =>
      header
        .map((k) => {
          const val = r?.[k] ?? '';
          const s = typeof val === 'string' ? val.replaceAll('"', '""') : String(val);
          return `"${s}"`;
        })
        .join(',')
    ),
  ];
  return lines.join('\n');
};

export default function TrialBalance() {
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState('');
  const [startDate, setStartDate] = useState('2025-06-01');
  const [endDate, setEndDate] = useState('2025-06-30');

  const [loading, setLoading] = useState(true);
  const [tb, setTb] = useState(null);
  const [error, setError] = useState('');

  const balanced = useMemo(() => Boolean(tb?.totals?.balanced), [tb]);

  const fetchBranches = async () => {
    try {
      const plants = await getPlants();
      const normalized = Array.isArray(plants)
        ? plants
            .map((p) => ({ id: p?.id || p?._id, name: p?.name || 'Unnamed Branch' }))
            .filter((x) => x.id)
        : [];
      setBranches(normalized);
    } catch {
      setBranches([]);
    }
  };

  const fetchTB = async () => {
    if (!startDate || !endDate) return;
    setLoading(true);
    setError('');
    try {
      const res = await glTrialBalance({
        startDate,
        endDate,
        branchIdOrZoneId: branchId || undefined,
      });
      setTb(res || null);
    } catch (e) {
      console.error(e);
      setTb(null);
      setError(e?.response?.data?.message || e?.message || 'Failed to load trial balance.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBranches();
  }, []);

  useEffect(() => {
    fetchTB();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, startDate, endDate]);

  const exportCsv = () => {
    const rows = Array.isArray(tb?.rows) ? tb.rows : [];
    const csv = toCsv(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `trial_balance_${startDate}_to_${endDate}${branchId ? `_branch_${branchId}` : ''}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const unusualRows = useMemo(() => {
    const rows = Array.isArray(tb?.rows) ? tb.rows : [];
    // “Unusual” = huge movement compared to median
    const absBalances = rows.map((r) => Math.abs(safeNum(r.balance, 0))).filter((x) => x > 0).sort((a, b) => a - b);
    const median = absBalances.length ? absBalances[Math.floor(absBalances.length / 2)] : 0;
    const threshold = median > 0 ? median * 8 : 0;
    return rows.filter((r) => threshold > 0 && Math.abs(safeNum(r.balance, 0)) >= threshold);
  }, [tb]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <PageTitle title="Trial Balance" subtitle="GL-first validation: Debits must equal Credits" />
        <div className="flex gap-2">
          <Button variant="secondary" icon={RefreshCw} onClick={fetchTB}>
            Refresh
          </Button>
          <Button variant="secondary" icon={Download} onClick={exportCsv} disabled={!tb}>
            Export CSV
          </Button>
        </div>
      </div>

      <Card className="bg-white/5 border border-white/10 rounded-xl p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div>
            <label className="text-xs text-gray-400">Branch</label>
            <select
              className="w-full mt-1 px-3 py-2 rounded-lg bg-black/30 text-white border border-white/10"
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

          <div>
            <label className="text-xs text-gray-400">Start</label>
            <input
              type="date"
              className="w-full mt-1 px-3 py-2 rounded-lg bg-black/30 text-white border border-white/10"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>

          <div>
            <label className="text-xs text-gray-400">End</label>
            <input
              type="date"
              className="w-full mt-1 px-3 py-2 rounded-lg bg-black/30 text-white border border-white/10"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>

          <div className="text-xs text-gray-400 md:text-right">
            {tb?.totals ? (
              <div className="flex items-center justify-between md:justify-end gap-2">
                {balanced ? (
                  <span className="inline-flex items-center gap-1 text-emerald-300">
                    <CheckCircle2 size={14} /> Balanced
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-amber-300">
                    <AlertTriangle size={14} /> Not Balanced
                  </span>
                )}
                <span className="text-[10px] text-gray-500">diff: {safeNum(tb?.totals?.diff, 0).toFixed(2)}</span>
              </div>
            ) : (
              <div className="text-[10px] text-gray-500">—</div>
            )}
          </div>
        </div>
      </Card>

      {loading ? (
        <div className="p-10 text-center text-blue-400 animate-pulse">Loading trial balance...</div>
      ) : error ? (
        <div className="p-10 text-center text-gray-400">{error}</div>
      ) : !tb ? (
        <div className="p-10 text-center text-gray-500">No data.</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="bg-white/5 border border-white/10 rounded-xl p-4">
              <div className="text-xs text-gray-400">Total Debit</div>
              <div className="text-white font-bold text-xl mt-1">{safeNum(tb?.totals?.debit, 0).toLocaleString()}</div>
            </Card>
            <Card className="bg-white/5 border border-white/10 rounded-xl p-4">
              <div className="text-xs text-gray-400">Total Credit</div>
              <div className="text-white font-bold text-xl mt-1">{safeNum(tb?.totals?.credit, 0).toLocaleString()}</div>
            </Card>
            <Card className="bg-white/5 border border-white/10 rounded-xl p-4">
              <div className="text-xs text-gray-400">Balanced?</div>
              <div className={`font-bold text-xl mt-1 ${balanced ? 'text-emerald-300' : 'text-amber-300'}`}>
                {balanced ? 'YES' : 'NO'}
              </div>
            </Card>
          </div>

          {unusualRows.length ? (
            <Card className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-4">
              <div className="text-sm font-semibold text-yellow-200 flex items-center gap-2">
                <AlertTriangle size={16} /> Unusual movements detected
              </div>
              <div className="text-[11px] text-yellow-100/80 mt-1">
                These accounts have unusually large balances vs the median (quick audit cue).
              </div>
              <ul className="mt-2 list-disc pl-5 text-[11px] text-yellow-100/80">
                {unusualRows.slice(0, 6).map((r) => (
                  <li key={r.accountCode}>
                    {r.accountCode} — {r.name} ({safeNum(r.balance, 0).toLocaleString()})
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card className="bg-white/5 border border-white/10 rounded-xl p-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-white/10 text-gray-300">
                <tr>
                  <th className="text-left py-2">Code</th>
                  <th className="text-left py-2">Account</th>
                  <th className="text-left py-2">Type</th>
                  <th className="text-right py-2">Debit</th>
                  <th className="text-right py-2">Credit</th>
                  <th className="text-right py-2">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {(tb?.rows || []).map((r) => (
                  <tr key={r.accountCode}>
                    <td className="py-2 text-gray-200 font-mono">{r.accountCode}</td>
                    <td className="py-2 text-gray-200">{r.name}</td>
                    <td className="py-2 text-gray-400 text-xs">{r.type}</td>
                    <td className="py-2 text-right text-gray-200">{safeNum(r.debit, 0).toLocaleString()}</td>
                    <td className="py-2 text-right text-gray-200">{safeNum(r.credit, 0).toLocaleString()}</td>
                    <td className="py-2 text-right text-white font-semibold">{safeNum(r.balance, 0).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}