// src/views/02-Operations/Dashboard.js
import React, { useMemo, useState, useEffect } from 'react';
import { getDashboardKpis, getSalesChartData } from '../../api/analyticsService';
import { getOnlineDrivers, getInventorySummary, getPlants } from '../../api/operationsService';
import PageTitle from '../../components/shared/PageTitle';
import BarChart from '../../components/charts/BarChart';
import {
  TrendingUp,
  ShoppingCart,
  Truck,
  Users,
  Activity,
  ArrowUpRight,
  AlertCircle,
  Zap,
  ExternalLink,
  RefreshCw,
  Factory,
  Package,
} from 'lucide-react';

// Enhanced Glass Card
const StatCard = ({ title, value, icon: Icon, color, trend, sub }) => (
  <div className="glass-card relative overflow-hidden group hover:border-white/20 transition-all duration-300">
    <div
      className={`absolute -right-6 -top-6 p-8 rounded-full opacity-10 group-hover:opacity-20 transition-all ${color} blur-xl`}
    ></div>
    <div className="relative z-10">
      <div className="flex justify-between items-start">
        <div>
          <p className="text-gray-400 text-xs font-bold uppercase tracking-wider">{title}</p>
          <h3 className="text-3xl font-bold text-white mt-2">{value}</h3>
          {sub ? <p className="text-[11px] text-gray-500 mt-2">{sub}</p> : null}
        </div>
        <div className={`p-3 rounded-xl bg-white/5 border border-white/10 ${color.replace('bg-', 'text-')}`}>
          <Icon size={24} />
        </div>
      </div>
      {trend ? (
        <div className="mt-4 flex items-center text-xs font-medium text-green-400">
          <ArrowUpRight size={14} className="mr-1" />
          {trend} since last month
        </div>
      ) : null}
    </div>
  </div>
);

const QuickAction = ({ label, icon: Icon, view, color, setActiveView }) => (
  <button
    onClick={() => setActiveView?.(view)}
    className="flex items-center p-4 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/20 transition-all group w-full text-left"
  >
    <div className={`p-2 rounded-lg mr-4 ${color} text-white`}>
      <Icon size={20} />
    </div>
    <div>
      <h4 className="text-sm font-bold text-white group-hover:text-blue-300 transition-colors">{label}</h4>
      <p className="text-[10px] text-gray-500">Jump to module</p>
    </div>
    <ExternalLink
      size={14}
      className="ml-auto text-gray-600 group-hover:text-white opacity-0 group-hover:opacity-100 transition-all"
    />
  </button>
);

const HealthRow = ({ label, value, tone = 'neutral' }) => {
  const toneStyles =
    tone === 'good'
      ? 'bg-green-500/10 border-green-500/20 text-green-300'
      : tone === 'warn'
      ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-300'
      : tone === 'bad'
      ? 'bg-red-500/10 border-red-500/20 text-red-300'
      : 'bg-white/5 border-white/10 text-gray-300';

  return (
    <div className={`text-xs p-3 rounded-xl border ${toneStyles} flex justify-between items-center`}>
      <span className="font-semibold text-white/90">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
};

export default function Dashboard({ setActiveView }) {
  const [stats, setStats] = useState({
    totalRevenue: 0,
    totalKgSold: 0,
    activeDeliveries: 0,
    onlineDrivers: 0,
  });
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastSyncAt, setLastSyncAt] = useState(null);

  // Ops/Health signals
  const [inventory, setInventory] = useState(null);
  const [plants, setPlants] = useState([]);
  const [partialErrors, setPartialErrors] = useState([]);

  const stockPercent = useMemo(() => {
    const cap = inventory?.totalCapacity || 0;
    const cur = inventory?.currentStock || 0;
    if (!cap || cap <= 0) return 0;
    return Math.max(0, Math.min(100, (cur / cap) * 100));
  }, [inventory]);

  const fetchData = async () => {
    setLoading(true);
    setPartialErrors([]);

    try {
      // ✅ Use allSettled so one failure doesn't crash the whole dashboard
      const results = await Promise.allSettled([
        getDashboardKpis(),
        getOnlineDrivers(),
        getSalesChartData('monthly'),
        // NEW: bring in ops health signals (safe, optional)
        getInventorySummary?.(),
        getPlants?.(),
      ]);

      // 1) KPIs
      const kpis =
        results[0].status === 'fulfilled'
          ? results[0].value
          : { totalRevenue: 0, totalKgSold: 0, activeDeliveries: 0 };

      // 2) Drivers
      const drivers = results[1].status === 'fulfilled' && Array.isArray(results[1].value) ? results[1].value : [];

      // 3) Sales Chart
      const sales = results[2].status === 'fulfilled' ? results[2].value : null;

      // 4) Inventory Summary (optional)
      const inv = results[3]?.status === 'fulfilled' ? results[3].value : null;

      // 5) Plant health (optional)
      const p = results[4]?.status === 'fulfilled' ? results[4].value : [];

      // Collect partial failures (for debugging visibility)
      const errs = [];
      results.forEach((r, idx) => {
        if (r.status === 'rejected') errs.push({ idx, message: r.reason?.message || String(r.reason) });
      });
      setPartialErrors(errs);

      setStats({
        ...kpis,
        onlineDrivers: drivers.length,
      });

      setInventory(inv);
      setPlants(Array.isArray(p) ? p : []);

      if (sales?.breakdown) {
        setChartData(
          sales.breakdown.map((item) => ({
            label: item.label,
            value: item.revenue,
          }))
        );
      } else {
        setChartData([]);
      }

      setLastSyncAt(new Date());
    } catch (error) {
      console.error('Dashboard Sync Failed', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  const plantDownCount = useMemo(() => plants.filter((pl) => pl?.status && pl.status !== 'Operational').length, [plants]);

  const stockTone = stockPercent < 20 ? 'bad' : stockPercent < 35 ? 'warn' : 'good';
  const plantTone = plantDownCount > 0 ? 'warn' : 'good';
  const fleetTone = (stats.onlineDrivers || 0) === 0 ? 'warn' : 'good';

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header Area */}
      <div className="flex justify-between items-end">
        <PageTitle title="Command Center" subtitle="Real-time Operational Intelligence" />
        <div className="flex items-center gap-3">
          {lastSyncAt ? (
            <div className="hidden md:flex items-center px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-gray-300 text-xs font-mono">
              Last sync: {lastSyncAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          ) : null}

          <button
            onClick={fetchData}
            className="glass-button px-3 py-1.5 flex items-center text-xs font-semibold"
            title="Refresh"
          >
            <RefreshCw size={14} className={`mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>

          <div className="flex items-center space-x-2 px-3 py-1.5 rounded-full bg-green-500/10 border border-green-500/20 text-green-400 text-xs font-mono">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
            </span>
            <span>SYSTEM ONLINE</span>
          </div>
        </div>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Total Revenue"
          value={loading ? '...' : `₦${(stats.totalRevenue || 0).toLocaleString()}`}
          icon={TrendingUp}
          color="bg-green-500"
          trend="+12.5%"
        />
        <StatCard
          title="LPG Output"
          value={loading ? '...' : `${(stats.totalKgSold || 0).toLocaleString()} kg`}
          icon={ShoppingCart}
          color="bg-blue-500"
          trend="+5.2%"
        />
        <StatCard
          title="Live Deliveries"
          value={loading ? '...' : stats.activeDeliveries || 0}
          icon={Truck}
          color="bg-purple-500"
          sub="Orders in-progress"
        />
        <StatCard
          title="Active Fleet"
          value={loading ? '...' : stats.onlineDrivers || 0}
          icon={Users}
          color="bg-orange-500"
          sub="Drivers online"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Chart */}
        <div className="lg:col-span-2 glass-card min-h-[400px]">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-bold text-white flex items-center">
              <Activity size={20} className="mr-2 text-blue-400" /> Revenue Trajectory
            </h3>
            <div className="text-[11px] text-gray-500">
              {chartData.length ? 'Monthly breakdown' : 'No sales chart data yet'}
            </div>
          </div>
          <BarChart data={chartData} />
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          {/* Quick Actions */}
          <div className="glass-card">
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center">
              <Zap size={16} className="mr-2 text-yellow-400" /> Quick Actions
            </h3>
            <div className="space-y-3">
              <QuickAction label="Dispatch Order" icon={Truck} view="Logistics" color="bg-blue-600" setActiveView={setActiveView} />
              <QuickAction label="Log Sale (POS)" icon={ShoppingCart} view="DailyLog" color="bg-green-600" setActiveView={setActiveView} />
              <QuickAction label="Inventory Intelligence" icon={Package} view="Inventory" color="bg-slate-700" setActiveView={setActiveView} />
              <QuickAction label="Plant Performance" icon={Factory} view="PlantStatus" color="bg-indigo-700" setActiveView={setActiveView} />
            </div>
          </div>

          {/* Operational Health */}
          <div className="glass-card border-t-4 border-blue-500">
            <h3 className="text-white font-bold mb-3 flex items-center">
              <AlertCircle size={18} className="mr-2 text-blue-400" /> Operational Health
            </h3>

            <div className="space-y-2">
              <HealthRow
                label="Stock Level"
                value={inventory ? `${stockPercent.toFixed(0)}% (${(inventory.currentStock || 0).toLocaleString()} kg)` : 'N/A'}
                tone={inventory ? stockTone : 'neutral'}
              />
              <HealthRow
                label="Plants"
                value={`${plants.length || 0} total • ${plantDownCount} attention`}
                tone={plants.length ? plantTone : 'neutral'}
              />
              <HealthRow
                label="Fleet Online"
                value={`${stats.onlineDrivers || 0} drivers`}
                tone={fleetTone}
              />
            </div>

            {partialErrors.length > 0 ? (
              <div className="mt-4 text-[11px] text-yellow-300/80 bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3">
                <div className="font-semibold text-yellow-200 mb-1">Partial data loaded</div>
                <ul className="list-disc list-inside space-y-1">
                  {partialErrors.slice(0, 3).map((e, idx) => (
                    <li key={idx} className="truncate">
                      {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          {/* System Alerts (static placeholders, keep your existing ones) */}
          <div className="glass-card border-t-4 border-red-500">
            <h3 className="text-white font-bold mb-3 flex items-center">
              <AlertCircle size={18} className="mr-2 text-red-500" /> System Alerts
            </h3>
            <div className="space-y-2">
              <div className="text-xs text-gray-400 p-2 bg-white/5 rounded border-l-2 border-yellow-500">
                <span className="text-white font-bold">Low Stock:</span> Main Plant (Lekki) at 15% capacity.
              </div>
              <div className="text-xs text-gray-400 p-2 bg-white/5 rounded border-l-2 border-blue-500">
                <span className="text-white font-bold">Audit:</span> 3 Unreconciled EOD reports pending.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
