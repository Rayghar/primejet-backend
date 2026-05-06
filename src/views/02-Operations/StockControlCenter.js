// src/views/02-Operations/StockControlCenter.js
import React, { useEffect, useState, useCallback } from 'react';
import PageTitle from '../../components/shared/PageTitle';
import Card from '../../components/shared/Card';
import Button from '../../components/shared/Button';
import { RefreshCw, Package, Scale, TrendingUp, AlertTriangle } from 'lucide-react';
import { getPlants } from '../../api/operationsService';
import {
  getInventorySummary,
  loadOpeningStock,
  getStockMovements,
  reconcileStock,
  getReconciliations,
  getGrossProfitReport,
} from '../../api/inventoryService';
import { formatCurrency, formatDate } from '../../utils/formatters';

const today = () => new Date().toISOString().slice(0, 10);
const safeNum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

export default function StockControlCenter() {
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState('');
  const [businessDate, setBusinessDate] = useState(today());
  const [summary, setSummary] = useState(null);
  const [movements, setMovements] = useState([]);
  const [recons, setRecons] = useState([]);
  const [profit, setProfit] = useState(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const [opening, setOpening] = useState({ quantityKg: '', costPerKg: '', targetSalePricePerKg: '' });
  const [recon, setRecon] = useState({ physicalQtyKg: '', reason: '', postVariance: true });

  useEffect(() => {
    getPlants().then((rows) => {
      const opts = Array.isArray(rows) ? rows.map((p) => ({ id: p._id || p.id, name: p.name || 'Unnamed Branch' })).filter((p) => p.id) : [];
      setBranches(opts);
      if (!branchId && opts[0]) setBranchId(opts[0].id);
    }).catch(() => setBranches([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback(async () => {
    if (!branchId) return;
    setLoading(true); setErr('');
    try {
      const [s, m, r, gp] = await Promise.all([
        getInventorySummary(branchId),
        getStockMovements({ branchId, endDate: businessDate, limit: 50 }),
        getReconciliations({ branchId, endDate: businessDate }),
        getGrossProfitReport({ branchId, startDate: businessDate.slice(0, 8) + '01', endDate: businessDate }),
      ]);
      setSummary(s);
      setMovements(Array.isArray(m?.items) ? m.items : []);
      setRecons(Array.isArray(r?.items) ? r.items : []);
      setProfit(gp || null);
    } catch (e) {
      setErr(e.message || 'Failed to refresh stock control data.');
    } finally { setLoading(false); }
  }, [branchId, businessDate]);

  useEffect(() => { refresh(); }, [refresh]);

  const submitOpening = async () => {
    setMsg(''); setErr('');
    try {
      await loadOpeningStock({ ...opening, branchId, businessDate });
      setOpening({ quantityKg: '', costPerKg: '', targetSalePricePerKg: '' });
      setMsg('Opening stock loaded. It will post Dr LPG Inventory / Cr Opening Balance Equity when GL posting runs.');
      await refresh();
    } catch (e) { setErr(e.message || 'Opening stock failed.'); }
  };

  const submitRecon = async () => {
    setMsg(''); setErr('');
    try {
      await reconcileStock({ ...recon, branchId, businessDate });
      setRecon({ physicalQtyKg: '', reason: '', postVariance: true });
      setMsg('Stock reconciliation recorded. Any variance movement has been created.');
      await refresh();
    } catch (e) { setErr(e.message || 'Reconciliation failed.'); }
  };

  const stockKg = safeNum(summary?.currentBulkLpgKg ?? summary?.currentStock, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageTitle title="Stock Control Center" subtitle="Opening stock, stock movements, reconciliation, WAC, COGS readiness and gross profit controls" />
        <Button variant="secondary" icon={RefreshCw} onClick={refresh}>{loading ? 'Refreshing...' : 'Refresh'}</Button>
      </div>

      <Card className="bg-white/5 border border-white/10 rounded-xl p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div><label className="text-xs text-gray-400">Branch</label><select className="glass-input w-full p-2" value={branchId} onChange={(e) => setBranchId(e.target.value)}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
          <div><label className="text-xs text-gray-400">Business Date</label><input type="date" className="glass-input w-full p-2" value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} /></div>
          <div className="text-xs text-gray-400 flex items-end">COGS posts from approved POS kg sold using WAC when stock exists.</div>
        </div>
      </Card>

      {err && <div className="p-3 rounded-xl border border-red-500/20 bg-red-500/10 text-red-200 text-sm">{err}</div>}
      {msg && <div className="p-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-200 text-sm">{msg}</div>}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-4 bg-white/5 border border-white/10"><div className="text-xs text-gray-400">Current LPG Stock</div><div className="text-2xl font-bold text-white">{stockKg.toLocaleString()} kg</div></Card>
        <Card className="p-4 bg-white/5 border border-white/10"><div className="text-xs text-gray-400">Stocked</div><div className="text-2xl font-bold text-white">{safeNum(summary?.totalStockedKg).toLocaleString()} kg</div></Card>
        <Card className="p-4 bg-white/5 border border-white/10"><div className="text-xs text-gray-400">MTD Revenue</div><div className="text-2xl font-bold text-white">{formatCurrency(profit?.revenue || 0)}</div></Card>
        <Card className="p-4 bg-white/5 border border-white/10"><div className="text-xs text-gray-400">MTD Gross Profit</div><div className={(profit?.grossProfit || 0) >= 0 ? 'text-2xl font-bold text-emerald-300' : 'text-2xl font-bold text-red-300'}>{formatCurrency(profit?.grossProfit || 0)}</div></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-4 bg-white/5 border border-white/10">
          <h3 className="font-bold text-white flex items-center gap-2"><Package size={18}/> Load Opening Stock</h3>
          <p className="text-xs text-gray-400 mt-1">Use once per branch before normal trading. GL entry: Dr Inventory / Cr Opening Balance Equity.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-4">
            <input className="glass-input p-2" type="number" placeholder="Qty kg" value={opening.quantityKg} onChange={(e) => setOpening({ ...opening, quantityKg: e.target.value })} />
            <input className="glass-input p-2" type="number" placeholder="Cost/kg" value={opening.costPerKg} onChange={(e) => setOpening({ ...opening, costPerKg: e.target.value })} />
            <input className="glass-input p-2" type="number" placeholder="Sale price/kg" value={opening.targetSalePricePerKg} onChange={(e) => setOpening({ ...opening, targetSalePricePerKg: e.target.value })} />
          </div>
          <Button className="mt-3" onClick={submitOpening}>Load Opening Stock</Button>
        </Card>

        <Card className="p-4 bg-white/5 border border-white/10">
          <h3 className="font-bold text-white flex items-center gap-2"><Scale size={18}/> Physical Stock Reconciliation</h3>
          <p className="text-xs text-gray-400 mt-1">Records physical count and posts variance to inventory variance if selected.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-4">
            <input className="glass-input p-2" type="number" placeholder="Physical qty kg" value={recon.physicalQtyKg} onChange={(e) => setRecon({ ...recon, physicalQtyKg: e.target.value })} />
            <input className="glass-input p-2" placeholder="Reason" value={recon.reason} onChange={(e) => setRecon({ ...recon, reason: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 text-xs text-gray-300 mt-3"><input type="checkbox" checked={recon.postVariance} onChange={(e) => setRecon({ ...recon, postVariance: e.target.checked })}/> Post variance to GL immediately</label>
          <Button className="mt-3" onClick={submitRecon}>Record Reconciliation</Button>
        </Card>
      </div>

      <Card className="p-4 bg-white/5 border border-white/10">
        <h3 className="font-bold text-white flex items-center gap-2"><TrendingUp size={18}/> Gross Profit Snapshot</h3>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mt-4 text-sm">
          <div><span className="text-gray-400">KG Sold</span><div className="font-bold text-white">{safeNum(profit?.kgSold).toLocaleString()} kg</div></div>
          <div><span className="text-gray-400">WAC/kg</span><div className="font-bold text-white">{formatCurrency(profit?.wacCostPerKg || 0)}</div></div>
          <div><span className="text-gray-400">COGS</span><div className="font-bold text-red-300">{formatCurrency(profit?.cogs || 0)}</div></div>
          <div><span className="text-gray-400">Gross Margin</span><div className="font-bold text-white">{safeNum(profit?.grossMarginPct).toFixed(1)}%</div></div>
          <div className="text-xs text-amber-200 flex items-center gap-1"><AlertTriangle size={14}/> COGS depends on stock history quality.</div>
        </div>
      </Card>

      <Card className="p-4 bg-white/5 border border-white/10">
        <h3 className="font-bold text-white">Stock Movement Ledger</h3>
        <div className="overflow-x-auto mt-3"><table className="w-full text-sm"><thead className="text-gray-400 border-b border-white/10"><tr><th className="text-left py-2">Date</th><th className="text-left">Type</th><th className="text-left">Direction</th><th className="text-right">Qty</th><th className="text-right">Unit Cost</th><th className="text-left">Narration</th></tr></thead><tbody className="divide-y divide-white/5">{movements.map((m) => <tr key={m._id}><td className="py-2">{formatDate(m.movementDate)}</td><td>{m.movementType}</td><td>{m.direction}</td><td className="text-right">{safeNum(m.quantityKg).toLocaleString()}</td><td className="text-right">{formatCurrency(m.unitCost || 0)}</td><td>{m.narration}</td></tr>)}</tbody></table></div>
      </Card>

      <Card className="p-4 bg-white/5 border border-white/10">
        <h3 className="font-bold text-white">Reconciliation History</h3>
        <div className="overflow-x-auto mt-3"><table className="w-full text-sm"><thead className="text-gray-400 border-b border-white/10"><tr><th className="text-left py-2">Date</th><th className="text-right">System</th><th className="text-right">Physical</th><th className="text-right">Variance</th><th className="text-left">Reason</th><th>Status</th></tr></thead><tbody className="divide-y divide-white/5">{recons.map((r) => <tr key={r._id}><td className="py-2">{formatDate(r.businessDate)}</td><td className="text-right">{safeNum(r.systemQtyKg).toLocaleString()}</td><td className="text-right">{safeNum(r.physicalQtyKg).toLocaleString()}</td><td className="text-right">{safeNum(r.varianceKg).toLocaleString()}</td><td>{r.reason}</td><td>{r.status}</td></tr>)}</tbody></table></div>
      </Card>
    </div>
  );
}
