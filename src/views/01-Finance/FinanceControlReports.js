import React, { useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { getCashMovementReport, getExpenseAnalysisReport, financialExportUrl } from '../../api/financialService';
import { glListReversalRequests, glApproveReversalRequest, glRejectReversalRequest, glGenerateFiscalPeriods, glListPeriods, glExportJournalsUrl } from '../../api/glService';

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
const money = (v) => `₦${Number(v || 0).toLocaleString()}`;

export default function FinanceControlReports() {
  const [filters, setFilters] = useState({ startDate: monthStart(), endDate: today(), branchIdOrZoneId: '' });
  const [cash, setCash] = useState(null);
  const [expenses, setExpenses] = useState(null);
  const [reversals, setReversals] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [error, setError] = useState('');
  const load = async () => {
    setError('');
    try {
      const [c, e, r, p] = await Promise.all([
        getCashMovementReport(filters),
        getExpenseAnalysisReport(filters),
        glListReversalRequests({ status: 'PENDING', limit: 50 }),
        glListPeriods({ startPeriod: String(filters.startDate).slice(0,7), endPeriod: String(filters.endDate).slice(0,7) })
      ]);
      setCash(c); setExpenses(e); setReversals(r?.items || []); setPeriods(p?.items || []);
    } catch (err) { setError(err.message || 'Failed to load finance controls'); }
  };
  useEffect(()=>{ load(); /* eslint-disable-next-line */ }, []);

  const approveRev = async (id) => { const comment = window.prompt('Approval comment for reversal?') || 'Approved'; await glApproveReversalRequest({ requestId: id, comment }); await load(); };
  const rejectRev = async (id) => { const comment = window.prompt('Rejection reason?'); if (!comment) return; await glRejectReversalRequest({ requestId: id, comment }); await load(); };
  const genPeriods = async () => { await glGenerateFiscalPeriods({ year: new Date(filters.startDate).getFullYear() }); await load(); };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold text-white">Finance Control Reports</h1><p className="text-sm text-slate-400">Cash movement, expense analysis, fiscal periods, exports and reversal approvals.</p></div>
        <button onClick={load} className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white flex items-center gap-2"><RefreshCw size={16}/>Refresh</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-slate-900/60 border border-white/10 rounded-2xl p-4">
        <label className="text-sm text-slate-300">Start<input className="mt-1 w-full bg-slate-950 border border-white/10 rounded-xl p-2" type="date" value={filters.startDate} onChange={(e)=>setFilters({...filters,startDate:e.target.value})}/></label>
        <label className="text-sm text-slate-300">End<input className="mt-1 w-full bg-slate-950 border border-white/10 rounded-xl p-2" type="date" value={filters.endDate} onChange={(e)=>setFilters({...filters,endDate:e.target.value})}/></label>
        <label className="text-sm text-slate-300">Branch / Plant ID<input className="mt-1 w-full bg-slate-950 border border-white/10 rounded-xl p-2" value={filters.branchIdOrZoneId} onChange={(e)=>setFilters({...filters,branchIdOrZoneId:e.target.value})}/></label>
        <div className="flex items-end"><button onClick={load} className="w-full px-4 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-white">Apply</button></div>
      </div>
      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-red-200">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4">
          <div className="flex justify-between items-center mb-3"><h2 className="font-bold text-white">Cash Movement</h2><a className="text-blue-300 flex gap-1" href={financialExportUrl({ ...filters, type:'cash-movement' })}><Download size={15}/>CSV</a></div>
          <p className="text-3xl font-bold text-white mb-3">{money(cash?.totalNetMovement)}</p>
          {(cash?.accounts || []).map((a)=><div key={a.accountCode} className="flex justify-between text-sm border-t border-white/5 py-2"><span>{a.accountCode}</span><span>{money(a.netMovement)}</span></div>)}
        </div>
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4">
          <div className="flex justify-between items-center mb-3"><h2 className="font-bold text-white">Expense Analysis</h2><a className="text-blue-300 flex gap-1" href={financialExportUrl({ ...filters, type:'expense-analysis' })}><Download size={15}/>CSV</a></div>
          <p className="text-3xl font-bold text-white mb-3">{money(expenses?.total)}</p>
          {(expenses?.rows || []).map((r,i)=><div key={i} className="flex justify-between text-sm border-t border-white/5 py-2"><span>{r.category} / {r.paymentDisposition}</span><span>{money(r.amount)}</span></div>)}
        </div>
      </div>

      <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4 overflow-x-auto">
        <div className="flex justify-between items-center mb-3"><h2 className="font-bold text-white">GL Reversal Approval Queue</h2><a className="text-blue-300 flex gap-1" href={glExportJournalsUrl(filters)}><Download size={15}/>Export Journals</a></div>
        <table className="w-full text-sm"><thead className="text-slate-400"><tr><th className="p-2 text-left">Requested</th><th className="p-2 text-left">Journal</th><th className="p-2 text-left">Reason</th><th className="p-2">Actions</th></tr></thead><tbody>{reversals.map((r)=><tr key={r._id} className="border-t border-white/5"><td className="p-2">{String(r.requestedAt || r.createdAt).slice(0,10)}</td><td className="p-2">{r.journalId?._id || r.journalId}</td><td className="p-2">{r.reason}</td><td className="p-2 text-right"><button onClick={()=>approveRev(r._id)} className="text-green-300 mr-3">Approve</button><button onClick={()=>rejectRev(r._id)} className="text-red-300">Reject</button></td></tr>)}</tbody></table>
        {reversals.length === 0 && <p className="text-slate-400 p-4">No pending reversal requests.</p>}
      </div>

      <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4">
        <div className="flex justify-between items-center mb-3"><h2 className="font-bold text-white">Fiscal Period Calendar</h2><button onClick={genPeriods} className="px-3 py-2 bg-slate-700 rounded-xl text-sm">Generate Year</button></div>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">{periods.map((p)=><div key={p.periodKey} className="bg-slate-950 rounded-xl p-3"><p className="font-bold text-white">{p.periodKey}</p><p className={p.status==='LOCKED'?'text-red-300':'text-green-300'}>{p.status}</p></div>)}</div>
      </div>
    </div>
  );
}
