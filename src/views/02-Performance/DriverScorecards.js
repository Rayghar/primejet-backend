// src/views/02-Operations/DriverScorecards.js
import React, { useMemo, useState, useEffect } from 'react';
import { getDriverPerformance } from '../../api/analyticsService';
import PageTitle from '../../components/shared/PageTitle';
import { Trophy, Clock, AlertTriangle, Star, TrendingUp } from 'lucide-react';

const ScoreCard = ({ driver, rank }) => {
  const isTopPerformer = rank === 1;

  const deliveries = Number(driver?.totalDeliveries || 0);
  const onTimeRate = Number(driver?.onTimeRate || 0);
  const rating = Number(driver?.rating || 0);
  const revenue = Number(driver?.revenueGenerated || 0);

  return (
    <div
      className={`glass-card mb-4 flex items-center justify-between ${
        isTopPerformer ? 'border-l-4 border-yellow-400 bg-yellow-400/5' : ''
      }`}
    >
      <div className="flex items-center min-w-0">
        <div
          className={`w-10 h-10 rounded-full flex items-center justify-center font-bold mr-4 ${
            isTopPerformer ? 'bg-yellow-400 text-black' : 'bg-white/10 text-gray-400'
          }`}
        >
          #{rank}
        </div>
        <div className="min-w-0">
          <h4 className="font-bold text-white text-lg truncate">{driver?.name || 'Unknown Driver'}</h4>
          <p className="text-xs text-blue-200 truncate">{driver?.vehicleModel || 'Fleet Vehicle'}</p>
        </div>
      </div>

      <div className="flex gap-8 text-center">
        <div>
          <p className="text-xs text-gray-400 mb-1">Deliveries</p>
          <p className="font-bold text-white text-lg">{deliveries}</p>
        </div>

        <div>
          <p className="text-xs text-gray-400 mb-1">On-Time %</p>
          <p className={`font-bold text-lg ${onTimeRate >= 95 ? 'text-green-400' : 'text-yellow-400'}`}>
            {onTimeRate}%
          </p>
        </div>

        <div>
          <p className="text-xs text-gray-400 mb-1">Rating</p>
          <div className="flex items-center justify-center text-yellow-400 font-bold text-lg">
            <Star size={16} fill="currentColor" className="mr-1" /> {Number.isFinite(rating) ? rating.toFixed(1) : '0.0'}
          </div>
        </div>

        <div className="hidden md:block">
          <p className="text-xs text-gray-400 mb-1">Revenue Gen.</p>
          <p className="font-bold text-green-400 text-lg">₦{revenue.toLocaleString()}</p>
        </div>
      </div>
    </div>
  );
};

const SummaryTile = ({ icon: Icon, tone, title, value, sub }) => (
  <div className={`glass-card p-6 flex items-center ${tone}`}>
    <Icon size={32} className="mr-4" />
    <div>
      <p className="text-sm text-gray-400">{title}</p>
      <p className="text-xl font-bold text-white">{value}</p>
      {sub ? <p className="text-[11px] text-gray-500 mt-1">{sub}</p> : null}
    </div>
  </div>
);

export default function DriverScorecards() {
  const [drivers, setDrivers] = useState([]);
  const [period, setPeriod] = useState('monthly');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      setLoading(true);
      try {
        const data = await getDriverPerformance(period);
        const arr = Array.isArray(data) ? data : [];

        // ✅ Better ranking: deliveries first, then rating, then on-time, then revenue
        const sorted = [...arr].sort((a, b) => {
          const d1 = Number(b?.totalDeliveries || 0) - Number(a?.totalDeliveries || 0);
          if (d1 !== 0) return d1;

          const r1 = Number(b?.rating || 0) - Number(a?.rating || 0);
          if (r1 !== 0) return r1;

          const t1 = Number(b?.onTimeRate || 0) - Number(a?.onTimeRate || 0);
          if (t1 !== 0) return t1;

          return Number(b?.revenueGenerated || 0) - Number(a?.revenueGenerated || 0);
        });

        setDrivers(sorted);
      } catch (e) {
        console.error(e);
        setDrivers([]);
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, [period]);

  const summary = useMemo(() => {
    const top = drivers[0];
    const avgTime =
      drivers.length > 0
        ? Math.round(
            drivers.reduce((acc, d) => acc + Number(d?.avgDeliveryTimeMinutes || 0), 0) / drivers.length
          )
        : null;

    const issues =
      drivers.reduce((acc, d) => acc + Number(d?.issuesReported || 0), 0) || 0;

    const avgTimeLabel = avgTime && avgTime > 0 ? `${avgTime} mins` : '—';
    const issuesLabel = issues > 0 ? `${issues} reported` : '0 reported';

    return {
      topName: top?.name || '—',
      avgTimeLabel,
      issuesLabel,
    };
  }, [drivers]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <PageTitle title="Driver Performance" subtitle="Efficiency metrics and fleet leaderboard" />
        <select value={period} onChange={(e) => setPeriod(e.target.value)} className="glass-input p-2 text-sm bg-black/20">
          <option value="weekly">This Week</option>
          <option value="monthly">This Month</option>
          <option value="allTime">All Time</option>
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <SummaryTile
          icon={Trophy}
          tone="text-green-400"
          title="Top Performer"
          value={summary.topName}
          sub="Based on ranking rules"
        />
        <SummaryTile
          icon={Clock}
          tone="text-blue-400"
          title="Avg Delivery Time"
          value={summary.avgTimeLabel}
          sub="From driver stats (if provided)"
        />
        <SummaryTile
          icon={AlertTriangle}
          tone="text-yellow-400"
          title="Issues Reported"
          value={summary.issuesLabel}
          sub="From driver stats (if provided)"
        />
      </div>

      <div className="bg-black/20 rounded-2xl p-1">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Calculating Performance Metrics...</div>
        ) : drivers.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No driver data for this period.</div>
        ) : (
          <>
            <div className="px-4 pt-4 pb-2 text-xs text-gray-500 flex items-center">
              <TrendingUp size={14} className="mr-2" />
              Ranked by: Deliveries → Rating → On-time % → Revenue
            </div>
            <div className="p-3">
              {drivers.map((drv, i) => (
                <ScoreCard key={drv.id || i} driver={drv} rank={i + 1} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
