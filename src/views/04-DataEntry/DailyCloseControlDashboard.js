import React, { useEffect, useState } from 'react';
import { RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { getDailyCloseDashboard } from '../../api/dataEntryService';

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
const money = (v) => `₦${Number(v || 0).toLocaleString()}`;

export default function DailyCloseControlDashboard({ setActiveView }) {
  const [filters, setFilters] = useState({ startDate: monthStart(), endDate: today(), branchIdOrZoneId: '' });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try { setData(await getDailyCloseDashboard(filters)); }
    catch (e) { setError(e.message || 'Failed to load daily close dashboard'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const summary = data?.summary || {};
  const cards = [
    ['Open Days', summary.openDays || 0],
    ['Pending Approval', summary.pendingApproval || 0],
    ['Approved', summary.approved || 0],
    ['Rejected', summary.rejected || 0],
    ['Approved Unposted', summary.approvedUnposted || 0],
    ['Failed Postings', summary.failedPostings || 0],
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Daily Close Control Dashboard</h1>
          <p className="text-sm text-slate-400">Control tower for open, pending, approved, rejected and failed daily close items.</p>
        </div>
        <button onClick={load} className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white flex items-center gap-2"><RefreshCw size={16}/>Refresh</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-slate-900/60 border border-white/10 rounded-2xl p-4">
        <label className="text-sm text-slate-300">Start Date<input className="mt-1 w-full bg-slate-950 border border-white/10 rounded-xl p-2" type="date" value={filters.startDate} onChange={(e)=>setFilters({...filters,startDate:e.target.value})}/></label>
        <label className="text-sm text-slate-300">End Date<input className="mt-1 w-full bg-slate-950 border border-white/10 rounded-xl p-2" type="date" value={filters.endDate} onChange={(e)=>setFilters({...filters,endDate:e.target.value})}/></label>
        <label className="text-sm text-slate-300">Branch / Plant ID<input className="mt-1 w-full bg-slate-950 border border-white/10 rounded-xl p-2" value={filters.branchIdOrZoneId} onChange={(e)=>setFilters({...filters,branchIdOrZoneId:e.target.value})}/></label>
        <div className="flex items-end"><button onClick={load} className="w-full px-4 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-white">Apply Filters</button></div>
      </div>

      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-red-200">{error}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        {cards.map(([label, value]) => <div key={label} className="bg-slate-900/60 border border-white/10 rounded-2xl p-4"><p className="text-xs text-slate-400">{label}</p><p className="text-2xl font-bold text-white">{value}</p></div>)}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4">
          <h2 className="font-bold text-white mb-3 flex items-center gap-2"><AlertTriangle size={18}/>Alerts</h2>
          {(data?.alerts || []).length === 0 ? <p className="text-slate-400 flex items-center gap-2"><CheckCircle2 size={18}/>No daily close alerts in this period.</p> : <ul className="space-y-2">{data.alerts.map((x,i)=><li key={i} className="text-amber-200 bg-amber-500/10 border border-amber-500/20 rounded-xl p-2">{x}</li>)}</ul>}
        </div>
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4">
          <h2 className="font-bold text-white mb-3">Financial Summary</h2>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-slate-950 rounded-xl p-3"><p className="text-slate-400">Total Sales</p><p className="text-lg font-bold text-white">{money(summary.totalSales)}</p></div>
            <div className="bg-slate-950 rounded-xl p-3"><p className="text-slate-400">Total Expenses</p><p className="text-lg font-bold text-white">{money(summary.totalExpenses)}</p></div>
          </div>
        </div>
      </div>

      <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4 overflow-x-auto">
        <h2 className="font-bold text-white mb-3">Unresolved Daily Close Items</h2>
        <table className="w-full text-sm text-left">
          <thead className="text-slate-400"><tr><th className="p-2">Date</th><th className="p-2">Branch</th><th className="p-2">Status</th><th className="p-2">Sales</th><th className="p-2">Expenses</th><th className="p-2">Action</th></tr></thead>
          <tbody>
            {(data?.staleItems || []).map((x) => <tr key={x._id} className="border-t border-white/5"><td className="p-2">{String(x.date || '').slice(0,10)}</td><td className="p-2">{x.branchId?.name || x.branchId || '-'}</td><td className="p-2 uppercase">{x.status}</td><td className="p-2">{money(x.sales?.totalRevenue)}</td><td className="p-2">{money(x.expenses?.total)}</td><td className="p-2"><button onClick={()=>setActiveView?.('CloseWorkspace')} className="text-blue-300 hover:text-blue-200">Open Workspace</button></td></tr>)}
          </tbody>
        </table>
        {!loading && (data?.staleItems || []).length === 0 && <p className="text-slate-400 p-4">No unresolved daily close items found.</p>}
      </div>
    </div>
  );
}
