// File: src/views/03-Finance/GLHealth.js
import React, { useEffect, useMemo, useState } from 'react';
import PageTitle from '../../components/shared/PageTitle';
import Card from '../../components/shared/Card';
import Button from '../../components/shared/Button';
import { getPlants } from '../../api/operationsService';
import { glHealth, glPostingExceptions } from '../../api/glService';
import { RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';

export default function GLHealth() {
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState('');
  const [startDate, setStartDate] = useState('2025-06-01');
  const [endDate, setEndDate] = useState('2025-06-30');

  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState(null);
  const [error, setError] = useState('');

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

  const fetchHealth = async () => {
    if (!startDate || !endDate) return;
    setLoading(true);
    setError('');
    try {
      const res = await glPostingExceptions({
        startDate,
        endDate,
        branchIdOrZoneId: branchId || undefined,
      });
      setHealth(res || null);
    } catch (e) {
      console.error(e);
      setHealth(null);
      setError(e?.response?.data?.message || e?.message || 'Failed to load GL health.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBranches();
  }, []);

  useEffect(() => {
    fetchHealth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, startDate, endDate]);

  const reasons = useMemo(() => {
    const r = health?.exceptions?.reasons || health?.reasons || {};
    const keys = Object.keys(r);
    keys.sort((a, b) => (r[b]?.count || 0) - (r[a]?.count || 0));
    return keys.map((k) => ({ code: k, count: r[k]?.count || 0, examples: r[k]?.examples || [] }));
  }, [health]);

  const failedTotal = useMemo(() => health?.failedPostingCount || health?.exceptions?.totals?.failed || health?.totals?.failed || 0, [health]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <PageTitle title="GL Health" subtitle="Posting exceptions and migration readiness" />
        <div className="flex gap-2">
          <Button variant="secondary" icon={RefreshCw} onClick={fetchHealth}>
            Refresh
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
            {failedTotal > 0 ? (
              <span className="inline-flex items-center gap-1 text-amber-300">
                <AlertTriangle size={14} /> {failedTotal} failed postings
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-emerald-300">
                <CheckCircle2 size={14} /> No posting failures
              </span>
            )}
          </div>
        </div>
      </Card>

      {loading ? (
        <div className="p-10 text-center text-blue-400 animate-pulse">Loading GL health...</div>
      ) : error ? (
        <div className="p-10 text-center text-gray-400">{error}</div>
      ) : !health ? (
        <div className="p-10 text-center text-gray-500">No data.</div>
      ) : (
        <>
          <Card className="bg-white/5 border border-white/10 rounded-xl p-4">
            <div className="text-sm font-semibold text-white mb-2">Failures by Reason</div>

            {reasons.length === 0 ? (
              <div className="text-xs text-gray-500">No failures in this period.</div>
            ) : (
              <div className="space-y-3">
                {reasons.map((r) => (
                  <div key={r.code} className="p-3 rounded-xl bg-black/20 border border-white/10">
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-gray-200 font-semibold">{r.code}</div>
                      <div className="text-xs text-amber-300">{r.count}</div>
                    </div>

                    {r.examples.length ? (
                      <div className="mt-2 text-[11px] text-gray-400">
                        Examples:
                        <ul className="list-disc pl-5 mt-1 space-y-1">
                          {r.examples.slice(0, 5).map((ex, idx) => (
                            <li key={idx}>
                              <span className="text-gray-200">{ex.sourceType}</span> • {ex.sourceId} • {ex.businessDate}{' '}
                              {ex.message ? <span className="text-gray-500">— {ex.message}</span> : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="bg-white/5 border border-white/10 rounded-xl p-4">
            <div className="text-sm font-semibold text-white">What to do next</div>
            <ul className="mt-2 list-disc pl-5 text-xs text-gray-300 space-y-1">
              <li>Fix the data quality issue (missing date/branch, zero revenue, unmapped category).</li>
              <li>Retry posting for the period (GL module: retry-failed).</li>
              <li>Confirm Trial Balance becomes balanced, then proceed to Financial Statements.</li>
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}