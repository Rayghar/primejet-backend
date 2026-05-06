// src/views/03-Intelligence/DeliveryHeatmap.js
import React, { useMemo, useState, useEffect } from 'react';
import { getHeatmapData } from '../../api/analyticsService';
import PageTitle from '../../components/shared/PageTitle';
import { Map, Layers, RefreshCw, AlertTriangle } from 'lucide-react';

const safeArr = (v) => (Array.isArray(v) ? v : []);
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

export default function DeliveryHeatmap() {
  const [points, setPoints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState('revenue'); // revenue | volume
  const [threshold, setThreshold] = useState(50000);

  const fetchPoints = async () => {
    setError('');
    setSyncing(true);
    try {
      const data = await getHeatmapData({ mode }); // ✅ allow backend filtering (optional)
      setPoints(safeArr(data));
    } catch (e) {
      console.error('Heatmap load error', e);
      setError(e?.response?.data?.message || e?.message || 'Failed to load heatmap data.');
      setPoints([]);
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  };

  useEffect(() => {
    fetchPoints();
    const t = setInterval(fetchPoints, 60000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const stats = useMemo(() => {
    const arr = safeArr(points);
    const total = arr.length;
    const max = arr.reduce((m, p) => Math.max(m, Number(p?.weight || 0)), 0);
    const high = arr.filter((p) => Number(p?.weight || 0) >= threshold).length;
    return { total, max, high };
  }, [points, threshold]);

  const visiblePoints = useMemo(() => {
    // Keep UI snappy if backend returns huge datasets
    const arr = safeArr(points);
    return arr.slice(0, 300);
  }, [points]);

  return (
    <div className="h-[calc(100vh-120px)] flex flex-col">
      <div className="flex justify-between items-center mb-4">
        <PageTitle title="Delivery Demand Heatmap" subtitle="Geospatial analysis of high-value zones" />

        <div className="flex items-center gap-2">
          <div className="glass-card py-2 px-3 flex items-center gap-2">
            <Layers size={14} className="text-gray-400" />
            <select
              className="bg-transparent text-xs text-gray-200 outline-none"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              title="Heatmap mode"
            >
              <option value="revenue">Revenue Weight</option>
              <option value="volume">Volume Weight</option>
            </select>
          </div>

          <button onClick={fetchPoints} className="glass-button px-4 py-2 flex items-center text-sm" disabled={syncing}>
            <RefreshCw size={16} className={`mr-2 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error ? (
        <div className="glass-card border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200 flex items-start mb-4">
          <AlertTriangle size={18} className="mr-2 mt-0.5 text-red-400" />
          <div>
            <p className="font-bold text-red-300">Heatmap Data Unavailable</p>
            <p className="text-xs text-red-200/80 mt-1">{error}</p>
          </div>
        </div>
      ) : null}

      <div className="flex-1 glass-card p-0 relative overflow-hidden">
        {/* Placeholder for actual Google Map with HeatmapLayer */}
        <div className="absolute inset-0 bg-[#111] flex flex-col items-center justify-center">
          {loading ? (
            <p className="text-blue-400 animate-pulse">Loading Geospatial Data...</p>
          ) : (
            <div className="relative w-full h-full opacity-60">
              {/* Simulated Heatmap Points */}
              {visiblePoints.map((pt, i) => {
                const w = Number(pt?.weight || 0);

                // ✅ deterministic placement, keeps "movement" stable per point
                const top = ((Number(pt?.lat || 0) * 1000) % 80) + 10;
                const left = ((Number(pt?.lng || 0) * 1000) % 80) + 10;

                const isHigh = w >= threshold;
                const size = clamp(30 + Math.log10(Math.max(1, w)) * 18, 30, 90);

                return (
                  <div
                    key={pt.id || i}
                    className="absolute rounded-full blur-2xl"
                    style={{
                      top: `${top}%`,
                      left: `${left}%`,
                      width: `${size}px`,
                      height: `${size}px`,
                      background: isHigh ? 'rgba(239, 68, 68, 0.55)' : 'rgba(34, 197, 94, 0.35)',
                    }}
                    title={`weight: ${w}`}
                  />
                );
              })}

              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="text-center">
                  <Map size={48} className="mx-auto text-gray-500 mb-2" />
                  <p className="text-gray-300">Interactive Map Component</p>
                  <p className="text-xs text-gray-600">
                    Overlaying {stats.total.toLocaleString()} points (showing {visiblePoints.length.toLocaleString()})
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Legend + Controls */}
        <div className="absolute bottom-6 left-6 glass p-4 rounded-xl w-[260px]">
          <h4 className="text-xs font-bold text-gray-400 uppercase mb-2">Demand Intensity</h4>

          <div className="w-full h-2 bg-gradient-to-r from-green-400 via-yellow-400 to-red-500 rounded-full" />
          <div className="flex justify-between text-[10px] text-gray-500 mt-1">
            <span>Low</span>
            <span>High</span>
          </div>

          <div className="mt-4">
            <div className="flex justify-between text-[10px] text-gray-500 mb-2">
              <span>High-value threshold</span>
              <span className="text-gray-300 font-mono">{threshold.toLocaleString()}</span>
            </div>
            <input
              type="range"
              min={0}
              max={Math.max(100000, stats.max || 100000)}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="w-full"
            />
            <div className="mt-2 text-[10px] text-gray-500">
              High-value zones: <span className="text-gray-200 font-bold">{stats.high.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
