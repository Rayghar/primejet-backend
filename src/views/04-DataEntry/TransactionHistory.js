// src/views/04-DataEntry/TransactionHistory.js
import React, { useEffect, useMemo, useState } from 'react';
import PageTitle from '../../components/shared/PageTitle';
import Card from '../../components/shared/Card';
import Button from '../../components/shared/Button';
import { getTransactionHistory } from '../../api/dataEntryService';
import { glListJournals, glRequestReversal } from '../../api/glService';
import { RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';

const safeNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const money = (v) => `₦${safeNum(v).toLocaleString()}`;
const fmt = (d) => {
  const x = d ? new Date(d) : null;
  if (!x || Number.isNaN(x.getTime())) return '—';
  return x.toISOString().slice(0, 10);
};
const idOf = (x) => String(x?._id || x?.id || x?.sourceId || Math.random());
const sourceAmount = (t) => safeNum(t?.amount ?? t?.totalRevenue ?? t?.revenue ?? t?.sales?.totalRevenue);
const glRef = (t) => t?.posting?.glEntryId || (Array.isArray(t?.posting?.glEntryIds) ? t.posting.glEntryIds[0] : null) || '—';

const Tab = ({ active, onClick, children }) => (
  <button
    onClick={onClick}
    className={`px-4 py-2 rounded-lg text-sm font-semibold ${
      active ? 'bg-blue-600 text-white' : 'bg-white/5 text-gray-300 hover:bg-white/10'
    }`}
  >
    {children}
  </button>
);

const Badge = ({ value }) => {
  const v = String(value || '—').toUpperCase();
  const cls = v === 'POSTED' ? 'text-emerald-300' : v === 'FAILED' ? 'text-red-300' : 'text-amber-300';
  return <span className={`font-semibold ${cls}`}>{v}</span>;
};

export default function TransactionHistory() {
  const [mode, setMode] = useState('source'); // 'source' | 'gl'
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [expanded, setExpanded] = useState({});
  const [reverseTarget, setReverseTarget] = useState(null);
  const [reverseReason, setReverseReason] = useState('');
  const [busyReverse, setBusyReverse] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);

  const load = async () => {
    setLoading(true);
    setErr('');
    try {
      const filters = {};
      if (startDate) filters.startDate = startDate;
      if (endDate) filters.endDate = endDate;

      if (mode === 'gl') {
        const r = await glListJournals({ ...filters, limit: 200 });
        setRows(Array.isArray(r?.items) ? r.items : Array.isArray(r) ? r : []);
      } else {
        const r = await getTransactionHistory(filters);
        setRows(Array.isArray(r) ? r : []);
      }
    } catch (e) {
      setErr(e?.message || 'Failed to load history.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const shaped = useMemo(() => rows, [rows]);
  const toggle = (key) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  const doReverseJournal = async () => {
    if (!reverseTarget) return;
    const reason = String(reverseReason || '').trim();
    if (!reason) { setErr('Reversal reason is required.'); return; }
    setBusyReverse(true);
    setErr('');
    try {
      await glRequestReversal({ journalId: idOf(reverseTarget), reason });
      setReverseTarget(null);
      setReverseReason('');
      await load();
    } catch (e) {
      setErr(e?.message || 'Failed to reverse journal.');
    } finally {
      setBusyReverse(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <PageTitle title="Ledger / Transaction Trace" subtitle="Source documents, Daily Summary postings, and GL journals" />
        <Button variant="secondary" icon={RefreshCw} onClick={load}>
          Refresh
        </Button>
      </div>

      <Card className="bg-white/5 border border-white/10 p-4 rounded-xl">
        <div className="flex flex-wrap gap-2 items-center">
          <Tab active={mode === 'source'} onClick={() => setMode('source')}>
            Source Docs
          </Tab>
          <Tab active={mode === 'gl'} onClick={() => setMode('gl')}>
            GL Journals
          </Tab>

          <div className="ml-auto flex gap-2 items-end">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Start</label>
              <input
                type="date"
                className="px-3 py-2 rounded-lg bg-black/30 text-white border border-white/10"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">End</label>
              <input
                type="date"
                className="px-3 py-2 rounded-lg bg-black/30 text-white border border-white/10"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <Button onClick={load}>Apply</Button>
          </div>
        </div>

        {err ? <div className="mt-3 text-xs text-red-300">{err}</div> : null}
        {mode === 'source' ? (
          <div className="mt-3 text-xs text-gray-400">
            Sales are posted to GL through the approved Daily Summary. Individual sales lines will show the same GL reference once the summary is posted.
          </div>
        ) : null}
      </Card>

      <Card className="bg-white/5 border border-white/10 p-0 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-blue-400 animate-pulse">Loading…</div>
        ) : mode === 'source' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-400 border-b border-white/10 bg-black/20">
                <tr>
                  <th className="text-left py-3 px-4">Date</th>
                  <th className="text-left py-3 px-4">Type</th>
                  <th className="text-left py-3 px-4">Description</th>
                  <th className="text-right py-3 px-4">Amount</th>
                  <th className="text-left py-3 px-4">Posting</th>
                  <th className="text-left py-3 px-4">GL Ref</th>
                  <th className="text-left py-3 px-4">Trace</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {shaped.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-6 px-4 text-gray-500">No records.</td>
                  </tr>
                ) : (
                  shaped.map((t) => (
                    <tr key={idOf(t)}>
                      <td className="py-3 px-4 text-gray-200">{fmt(t?.date || t?.createdAt)}</td>
                      <td className="py-3 px-4 text-gray-300">{t?.type || t?.sourceType || '—'}</td>
                      <td className="py-3 px-4 text-gray-200">
                        {t?.description || t?.narration || (t?.type === 'Sale' ? `${safeNum(t?.kgSold ?? t?.quantity)}kg ${t?.paymentMethod || ''}` : '—')}
                      </td>
                      <td className="py-3 px-4 text-right text-gray-200">{money(sourceAmount(t))}</td>
                      <td className="py-3 px-4"><Badge value={t?.posting?.status || 'UNPOSTED'} /></td>
                      <td className="py-3 px-4 text-gray-400 font-mono">{glRef(t)}</td>
                      <td className="py-3 px-4 text-gray-400 text-xs">
                        {t?.posting?.postedVia ? `via ${t.posting.postedVia}` : t?.sourceType || '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-400 border-b border-white/10 bg-black/20">
                <tr>
                  <th className="text-left py-3 px-4 w-10"></th>
                  <th className="text-left py-3 px-4">Date</th>
                  <th className="text-left py-3 px-4">Source</th>
                  <th className="text-left py-3 px-4">Narration</th>
                  <th className="text-right py-3 px-4">Debit</th>
                  <th className="text-right py-3 px-4">Credit</th>
                  <th className="text-left py-3 px-4">Status</th>
                  <th className="text-left py-3 px-4">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {shaped.length === 0 ? (
                  <tr><td colSpan={8} className="py-6 px-4 text-gray-500">No GL journals.</td></tr>
                ) : shaped.map((j) => {
                  const key = idOf(j);
                  const isOpen = Boolean(expanded[key]);
                  return (
                    <React.Fragment key={key}>
                      <tr className="hover:bg-white/5">
                        <td className="py-3 px-4">
                          <button onClick={() => toggle(key)} className="text-gray-300">
                            {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          </button>
                        </td>
                        <td className="py-3 px-4 text-gray-200">{fmt(j?.date)}</td>
                        <td className="py-3 px-4 text-gray-300 font-mono">{j?.sourceType} / {j?.sourceId}</td>
                        <td className="py-3 px-4 text-gray-200">{j?.narration || '—'}</td>
                        <td className="py-3 px-4 text-right text-gray-200">{money(j?.totals?.debit)}</td>
                        <td className="py-3 px-4 text-right text-gray-200">{money(j?.totals?.credit)}</td>
                        <td className="py-3 px-4"><Badge value={j?.status} /></td>
                        <td className="py-3 px-4">
                          {String(j?.status || '').toUpperCase() === 'POSTED' ? (
                            <button onClick={() => { setReverseTarget(j); setReverseReason(''); }} className="text-xs px-3 py-1 rounded bg-red-500/10 border border-red-500/20 text-red-200 hover:bg-red-500/20">Reverse</button>
                          ) : <span className="text-xs text-gray-500">—</span>}
                        </td>
                      </tr>
                      {isOpen ? (
                        <tr>
                          <td colSpan={8} className="px-4 pb-4">
                            <div className="rounded-xl bg-black/20 border border-white/10 p-3">
                              <div className="text-xs text-gray-400 mb-2">Journal ID: <span className="font-mono">{key}</span></div>
                              <table className="w-full text-xs">
                                <thead className="text-gray-500 border-b border-white/10">
                                  <tr>
                                    <th className="text-left py-2">Account</th>
                                    <th className="text-left py-2">Narration</th>
                                    <th className="text-right py-2">Debit</th>
                                    <th className="text-right py-2">Credit</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(j?.lines || []).map((l, i) => (
                                    <tr key={i} className="border-b border-white/5">
                                      <td className="py-2 text-gray-200 font-mono">{l.accountCode}</td>
                                      <td className="py-2 text-gray-300">{l.narration || '—'}</td>
                                      <td className="py-2 text-right text-gray-200">{money(l.debit)}</td>
                                      <td className="py-2 text-right text-gray-200">{money(l.credit)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    
      {reverseTarget ? (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-white/10 p-5 shadow-2xl">
            <div className="text-lg font-bold text-white">Request GL Journal Reversal</div>
            <div className="text-xs text-gray-400 mt-1">This submits the reversal for approval. Finance Controls executes approved reversals.</div>
            <div className="mt-3 text-xs text-gray-300 font-mono">{idOf(reverseTarget)}</div>
            <textarea className="mt-3 w-full min-h-[96px] px-3 py-2 rounded-lg bg-black/30 text-white border border-white/10 text-sm" placeholder="Reason for reversal" value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} />
            <div className="mt-4 flex justify-end gap-2">
              <button className="px-4 py-2 rounded-lg bg-white/5 text-gray-200" onClick={() => setReverseTarget(null)} disabled={busyReverse}>Cancel</button>
              <button className="px-4 py-2 rounded-lg bg-red-600 text-white disabled:opacity-50" onClick={doReverseJournal} disabled={busyReverse || !String(reverseReason || '').trim()}>Submit reversal request</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
