// src/views/03-Sales/SalesAnalytics.js
import React, { useEffect, useMemo, useState } from 'react';
import {
  getSalesReport,
  getSalesByPaymentMethod,
  getTopSellingProducts,
} from '../../api/analyticsService';
import { getPlants } from '../../api/operationsService';

import PageTitle from '../../components/shared/PageTitle';
import BarChart from '../../components/charts/BarChart';
import { TrendingUp, CreditCard, ShoppingBag, RefreshCw, AlertTriangle } from 'lucide-react';
import { formatCurrency } from '../../utils/formatters';

const safeArr = (v) => (Array.isArray(v) ? v : []);
const safeNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

export default function SalesAnalytics() {
  const [salesData, setSalesData] = useState(null);
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [topProducts, setTopProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [period, setPeriod] = useState('monthly');
  const [error, setError] = useState('');
  const [lastSyncAt, setLastSyncAt] = useState(null);

  // Optional branch filter
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState('');

  const fetchBranches = async () => {
    try {
      const plants = await getPlants?.();
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

  const load = async () => {
    if (loading) {
      setLoading(true);
    } else {
      setSyncing(true);
    }

    setError('');

    try {
      // ✅ keep dashboard pattern: one failure shouldn’t blank the page
      const results = await Promise.allSettled([
        getSalesReport(period, branchId || undefined),
        getSalesByPaymentMethod(branchId || undefined),
        getTopSellingProducts(branchId || undefined),
      ]);

      const report = results[0].status === 'fulfilled' ? results[0].value : null;
      const payments = results[1].status === 'fulfilled' ? results[1].value : [];
      const products = results[2].status === 'fulfilled' ? results[2].value : [];

      setSalesData(report || null);
      setPaymentMethods(safeArr(payments));
      setTopProducts(safeArr(products));

      const failures = results.filter((r) => r.status === 'rejected');
      if (failures.length) {
        setError('Some analytics modules failed to load. Data may be partial.');
      }

      setLastSyncAt(new Date());
    } catch (e) {
      console.error('Sales Analytics Load Error', e);
      setError('Failed to load analytics.');
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  };

  useEffect(() => {
    fetchBranches();
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, branchId]);

  const chartData = useMemo(() => {
    const breakdown = salesData?.breakdown;
    if (!Array.isArray(breakdown)) return [];
    return breakdown.map((item) => ({
      label: item.label,
      value: safeNum(item.revenue),
    }));
  }, [salesData]);

  const totalRevenue = safeNum(salesData?.totalRevenue, 0);
  const totalKgSold = safeNum(salesData?.totalKgSold, 0);

  const paymentRows = useMemo(() => {
    const rows = safeArr(paymentMethods).map((m) => {
      const totalAmount = safeNum(m?.totalAmount);
      const count = safeNum(m?.count);
      const contributionPct = totalRevenue > 0 ? (totalAmount / totalRevenue) * 100 : 0;

      return {
        name: m?._id || m?.name || 'unknown',
        totalAmount,
        count,
        contributionPct: Math.max(0, Math.min(100, contributionPct)),
      };
    });

    rows.sort((a, b) => b.totalAmount - a.totalAmount);
    return rows;
  }, [paymentMethods, totalRevenue]);

  const paymentTotal = useMemo(() => {
    return paymentRows.reduce((s, x) => s + safeNum(x.totalAmount), 0);
  }, [paymentRows]);

  const productRows = useMemo(() => {
    const rows = safeArr(topProducts).map((p) => {
      const revenue = safeNum(p?.totalRevenue, 0);
      const qty = safeNum(p?.totalQuantitySold, 0);
      const pct = totalRevenue > 0 ? Math.min(100, (revenue / totalRevenue) * 100) : 0;
      return {
        name: p?._id || p?.name || 'Unknown',
        qty,
        revenue,
        pct,
      };
    });

    // biggest first
    rows.sort((a, b) => b.revenue - a.revenue);
    return rows;
  }, [topProducts, totalRevenue]);

  const top3Revenue = useMemo(() => {
    return productRows.slice(0, 3).reduce((s, p) => s + safeNum(p.revenue), 0);
  }, [productRows]);

  const top3Contribution = totalRevenue > 0 ? (top3Revenue / totalRevenue) * 100 : 0;

  if (loading) {
    return <div className="p-8 text-center text-blue-400 animate-pulse">Loading Analytics...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center gap-4 flex-wrap">
        <PageTitle title="Sales Intelligence" subtitle="Revenue, Methods & Product Mix" />

        <div className="flex items-center gap-2">
          {lastSyncAt ? (
            <div className="hidden md:flex items-center px-3 py-2 rounded-full bg-white/5 border border-white/10 text-gray-300 text-xs font-mono">
              Last sync: {lastSyncAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          ) : null}

          <button
            onClick={load}
            className="glass-button px-3 py-2 flex items-center text-sm"
            title="Refresh"
            disabled={syncing}
          >
            <RefreshCw size={16} className={`mr-2 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="glass-card p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">Period</label>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="glass-input p-2 text-sm bg-black/20"
            >
              <option value="weekly">This Week</option>
              <option value="monthly">This Month</option>
              <option value="yearly">This Year</option>
            </select>
          </div>

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

          <div className="ml-auto text-xs text-gray-400 space-y-1">
            <div>
              Revenue: <span className="text-white font-semibold">{formatCurrency(totalRevenue)}</span>
            </div>
            <div>
              Volume: <span className="text-white font-semibold">{totalKgSold.toLocaleString()} kg</span>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="glass-card border-l-4 border-yellow-500 flex items-center gap-2 text-sm text-yellow-200">
          <AlertTriangle size={16} className="text-yellow-400" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Revenue Chart */}
        <div className="lg:col-span-2 glass-card">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-bold text-white flex items-center">
              <TrendingUp className="mr-2 text-green-500" /> Revenue Trend
            </h3>
            <div className="text-xs text-gray-400">
              Total: <span className="text-white font-bold">{formatCurrency(totalRevenue)}</span>
            </div>
          </div>

          <BarChart data={chartData} />

          {chartData.length === 0 && (
            <p className="text-xs text-gray-500 mt-3">No breakdown data available for this period.</p>
          )}

          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="p-3 bg-white/5 border border-white/10 rounded-xl">
              <p className="text-[11px] text-gray-400">Periods</p>
              <p className="text-white font-semibold">{chartData.length}</p>
            </div>
            <div className="p-3 bg-white/5 border border-white/10 rounded-xl">
              <p className="text-[11px] text-gray-400">Total Volume</p>
              <p className="text-white font-semibold">{totalKgSold.toLocaleString()} kg</p>
            </div>
            <div className="p-3 bg-white/5 border border-white/10 rounded-xl">
              <p className="text-[11px] text-gray-400">Avg per Period</p>
              <p className="text-white font-semibold">
                {formatCurrency(chartData.length ? totalRevenue / chartData.length : 0)}
              </p>
            </div>
          </div>
        </div>

        {/* Payment Methods */}
        <div className="glass-card flex flex-col">
          <h3 className="font-bold text-white mb-6 flex items-center">
            <CreditCard className="mr-2 text-blue-500" /> Payment Mix
          </h3>

          {paymentRows.length === 0 ? (
            <p className="text-sm text-gray-500">No payment method stats yet.</p>
          ) : (
            <div className="flex-1 space-y-3">
              {paymentRows.map((method, i) => (
                <div
                  key={`${method.name}-${i}`}
                  className="p-3 bg-white/5 rounded-xl border border-white/5"
                >
                  <div className="flex justify-between items-center">
                    <span className="capitalize text-gray-300">{method.name}</span>
                    <div className="text-right">
                      <p className="font-bold text-white">{formatCurrency(method.totalAmount)}</p>
                      <p className="text-xs text-gray-500">{method.count} txns</p>
                    </div>
                  </div>

                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex-1 w-full bg-gray-700 h-1.5 rounded-full overflow-hidden">
                      <div
                        className="bg-blue-500 h-full"
                        style={{ width: `${method.contributionPct}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-gray-400 w-10 text-right">
                      {method.contributionPct.toFixed(0)}%
                    </span>
                  </div>
                </div>
              ))}

              <div className="mt-2 pt-3 border-t border-white/10 text-xs text-gray-400 flex justify-between">
                <span>Payment Methods Total</span>
                <span className="text-white font-semibold">{formatCurrency(paymentTotal)}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Top Products Table */}
      <div className="glass-card">
        <div className="flex items-center justify-between mb-6">
          <h3 className="font-bold text-white flex items-center">
            <ShoppingBag className="mr-2 text-purple-500" /> Top Selling Products
          </h3>

          <div className="text-xs text-gray-400">
            Top 3 Contribution:{' '}
            <span className="text-white font-semibold">{top3Contribution.toFixed(1)}%</span>
          </div>
        </div>

        {productRows.length === 0 ? (
          <p className="text-sm text-gray-500">No product analytics yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/5 text-gray-300 uppercase text-xs">
                <tr>
                  <th className="p-4 rounded-tl-xl">Product Name</th>
                  <th className="p-4 text-right">Quantity Sold</th>
                  <th className="p-4 text-right">Revenue Generated</th>
                  <th className="p-4 rounded-tr-xl text-right">Contribution</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-white/5">
                {productRows.map((p, i) => (
                  <tr key={`${p.name}-${i}`} className="hover:bg-white/5 transition-colors">
                    <td className="p-4 font-medium text-white">{p.name}</td>
                    <td className="p-4 text-right text-blue-300">{p.qty.toLocaleString()}</td>
                    <td className="p-4 text-right font-bold text-green-400">
                      {formatCurrency(p.revenue)}
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <div className="w-28 bg-gray-700 h-1.5 rounded-full overflow-hidden">
                          <div className="bg-purple-500 h-full" style={{ width: `${p.pct}%` }} />
                        </div>
                        <span className="text-xs text-gray-400 w-12 text-right">
                          {p.pct.toFixed(0)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
