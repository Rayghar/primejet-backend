// src/views/02-Operations/Logistics.js
import React, { useState, useEffect, useContext, useMemo } from 'react';
import { SocketContext } from '../../contexts/SocketContext';
import { getUnassignedOrders, getOnlineDrivers, createRunFromBatch, getActiveRuns } from '../../api/operationsService';
import PageTitle from '../../components/shared/PageTitle';
import Notification from '../../components/shared/Notification';
import { MapPin, Truck, RefreshCw, Layers, CheckCircle, Navigation, Users, AlertCircle } from 'lucide-react';

export default function Logistics() {
  const { onlineDrivers: socketDrivers = [] } = useContext(SocketContext);

  const [orders, setOrders] = useState([]);
  const [drivers, setDrivers] = useState([]); // merged list (API + Socket)
  const [activeRuns, setActiveRuns] = useState([]);
  const [selectedOrderIds, setSelectedOrderIds] = useState([]);

  const [loading, setLoading] = useState(false);
  const [creatingRun, setCreatingRun] = useState(false);

  const [notification, setNotification] = useState({ show: false, message: '', type: 'success' });

  // Initial Data Fetch
  useEffect(() => {
    refreshData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshData = async () => {
    setLoading(true);
    try {
      const results = await Promise.allSettled([getUnassignedOrders(), getOnlineDrivers(), getActiveRuns()]);

      const ord = results[0].status === 'fulfilled' && Array.isArray(results[0].value) ? results[0].value : [];
      const drv = results[1].status === 'fulfilled' && Array.isArray(results[1].value) ? results[1].value : [];
      const runs = results[2].status === 'fulfilled' && Array.isArray(results[2].value) ? results[2].value : [];

      setOrders(ord);
      setDrivers(drv);
      setActiveRuns(runs);

      if (results.some((r) => r.status === 'rejected')) {
        setNotification({ show: true, message: 'Some logistics data failed to load (partial view).', type: 'error' });
      }
    } catch (e) {
      console.error('Logistics Load Error', e);
      setNotification({ show: true, message: 'Failed to load logistics data.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  // Merge Real-Time Socket Drivers with Initial List
  useEffect(() => {
    if (!socketDrivers || socketDrivers.length === 0) return;

    const socketDriverMap = new Map(socketDrivers.map((d) => [d.id, d]));

    setDrivers((prev) => {
      const prevSafe = Array.isArray(prev) ? prev : [];
      const updated = prevSafe.map((d) => (socketDriverMap.has(d.id) ? { ...d, ...socketDriverMap.get(d.id) } : d));

      socketDrivers.forEach((sd) => {
        if (!prevSafe.find((p) => p.id === sd.id)) updated.push(sd);
      });

      return updated;
    });
  }, [socketDrivers]);

  const toggleOrderSelection = (id) => {
    setSelectedOrderIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const selectedCount = selectedOrderIds.length;

  const handleCreateRun = async () => {
    if (selectedCount === 0) return;

    setCreatingRun(true);
    try {
      await createRunFromBatch(selectedOrderIds);
      setNotification({
        show: true,
        message: 'Batch created successfully! Go to “Active Runs” to monitor and assign (if needed).',
        type: 'success',
      });
      setSelectedOrderIds([]);
      await refreshData();
    } catch (e) {
      console.error(e);
      setNotification({ show: true, message: e?.response?.data?.message || e.message || 'Failed to create run.', type: 'error' });
    } finally {
      setCreatingRun(false);
    }
  };

  const safeDrivers = useMemo(() => (Array.isArray(drivers) ? drivers : []), [drivers]);
  const safeOrders = useMemo(() => (Array.isArray(orders) ? orders : []), [orders]);
  const safeRuns = useMemo(() => (Array.isArray(activeRuns) ? activeRuns : []), [activeRuns]);

  return (
    <div className="h-[calc(100vh-120px)] flex flex-col space-y-4">
      <Notification notification={notification} setNotification={setNotification} />

      <div className="flex justify-between items-center">
        <PageTitle title="Logistics Command" subtitle="Real-time Dispatch & Fleet Tracking" />

        <div className="flex items-center gap-2">
          <div className="hidden md:flex items-center px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-gray-300">
            <Users size={14} className="mr-2 text-green-400" />
            Online drivers: <span className="ml-2 font-mono text-white">{safeDrivers.length}</span>
          </div>

          <button onClick={refreshData} className="glass-button px-4 py-2 flex items-center text-sm">
            <RefreshCw size={16} className={`mr-2 ${loading ? 'animate-spin' : ''}`} /> Sync
          </button>
        </div>
      </div>

      <div className="flex-1 flex gap-6 overflow-hidden">
        {/* LEFT PANEL */}
        <div className="w-1/3 flex flex-col gap-4">
          {/* Unassigned Orders */}
          <div className="glass-card flex-1 flex flex-col overflow-hidden p-0 relative">
            <div className="p-4 border-b border-white/10 flex justify-between items-center bg-white/5 backdrop-blur-md sticky top-0 z-10">
              <h3 className="font-bold text-white flex items-center text-sm">
                <Layers size={16} className="mr-2 text-blue-400" />
                Unassigned ({safeOrders.length})
              </h3>

              <button
                onClick={handleCreateRun}
                disabled={selectedCount === 0 || creatingRun}
                className="px-3 py-1.5 bg-blue-600 rounded-lg text-xs text-white font-medium disabled:opacity-50 hover:bg-blue-500 transition-all"
              >
                {creatingRun ? 'Grouping…' : `Group Selected (${selectedCount})`}
              </button>
            </div>

            <div className="overflow-y-auto p-3 space-y-2 flex-1">
              {safeOrders.length === 0 ? (
                <div className="text-center py-10 text-gray-500 text-xs">No pending orders.</div>
              ) : (
                safeOrders.map((order) => (
                  <div
                    key={order.id}
                    onClick={() => toggleOrderSelection(order.id)}
                    className={`p-3 rounded-xl border cursor-pointer transition-all group relative overflow-hidden ${
                      selectedOrderIds.includes(order.id)
                        ? 'bg-blue-600/20 border-blue-500'
                        : 'bg-white/5 border-white/5 hover:bg-white/10'
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div className="min-w-0">
                        <span className="text-white font-medium text-sm block">{order.recipientName}</span>
                        <div className="flex items-center text-xs text-gray-400 mt-1">
                          <MapPin size={10} className="mr-1 shrink-0" />
                          <span className="truncate w-40">{order.deliveryAddressSnapshot?.fullAddress}</span>
                        </div>
                      </div>

                      <span className="text-[10px] text-blue-300 font-mono bg-blue-900/30 px-1.5 py-0.5 rounded">
                        {order.createdAt
                          ? new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                          : '--:--'}
                      </span>
                    </div>

                    {selectedOrderIds.includes(order.id) && (
                      <div className="absolute top-2 right-2 text-blue-400">
                        <CheckCircle size={14} />
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Active Runs */}
          <div className="glass-card h-1/3 flex flex-col overflow-hidden p-0">
            <div className="p-3 border-b border-white/10 bg-white/5 backdrop-blur-md flex justify-between items-center">
              <h3 className="font-bold text-white flex items-center text-sm">
                <Truck size={16} className="mr-2 text-green-400" /> Active Runs ({safeRuns.length})
              </h3>
              {safeRuns.length === 0 ? (
                <span className="text-[10px] text-gray-500 flex items-center">
                  <AlertCircle size={12} className="mr-1" /> none
                </span>
              ) : null}
            </div>

            <div className="overflow-y-auto p-3 space-y-2">
              {safeRuns.map((run) => {
                const totalStops = run.totalStops || 0;
                const done = run.completedStops || 0;
                const pct = totalStops > 0 ? Math.round((done / totalStops) * 100) : 0;

                return (
                  <div
                    key={run.id}
                    className="p-3 bg-white/5 border border-white/5 rounded-xl hover:bg-white/10 transition-colors"
                  >
                    <div className="flex justify-between text-sm items-center">
                      <span className="text-blue-300 font-mono">Run #{String(run.id).slice(0, 6)}</span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full ${
                          run.overallStatus === 'In Progress'
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-yellow-500/20 text-yellow-400'
                        }`}
                      >
                        {run.overallStatus || 'Pending'}
                      </span>
                    </div>

                    <div className="text-xs text-gray-400 mt-2 flex justify-between items-center">
                      <div className="flex items-center min-w-0">
                        <img
                          src={
                            run.driver?.photoUrl ||
                            `https://ui-avatars.com/api/?name=${encodeURIComponent(run.driver?.name || 'Driver')}&background=0f172a&color=fff`
                          }
                          className="w-5 h-5 rounded-full mr-2"
                          alt="driver"
                        />
                        <span className="truncate">{run.driver?.name || 'Assigning...'}</span>
                      </div>
                      <span className="font-mono">
                        {done}/{totalStops} ({pct}%)
                      </span>
                    </div>

                    <div className="w-full bg-gray-700/50 rounded-full h-1 mt-2 overflow-hidden">
                      <div className="bg-green-500 h-1 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* RIGHT PANEL */}
        <div className="w-2/3 glass-card p-0 overflow-hidden relative border-none shadow-2xl">
          <div className="absolute inset-0 bg-[#111] flex flex-col items-center justify-center">
            <div className="w-full h-full relative overflow-hidden group">
              {/* Fake Map Grid Background */}
              <div
                className="absolute inset-0 opacity-10"
                style={{
                  backgroundImage:
                    'linear-gradient(#333 1px, transparent 1px), linear-gradient(90deg, #333 1px, transparent 1px)',
                  backgroundSize: '40px 40px',
                }}
              ></div>

              {/* Simulated Drivers */}
              {safeDrivers.map((d, i) => (
                <div
                  key={d.id}
                  className="absolute flex flex-col items-center transition-all duration-1000 ease-linear"
                  style={{
                    top: `${
                      d.currentLocation?.coordinates?.[1]
                        ? (Number(d.currentLocation.coordinates[1]) % 0.1) * 1000
                        : 40 + i * 10
                    }%`,
                    left: `${
                      d.currentLocation?.coordinates?.[0]
                        ? (Number(d.currentLocation.coordinates[0]) % 0.1) * 1000
                        : 30 + i * 15
                    }%`,
                  }}
                >
                  <div className="relative">
                    <div className="w-3 h-3 bg-green-500 rounded-full animate-ping absolute opacity-75"></div>
                    <div className="w-8 h-8 bg-[#1e293b] border-2 border-green-500 rounded-full flex items-center justify-center shadow-lg shadow-green-500/20 z-10">
                      <Navigation size={14} className="text-green-500 transform rotate-45" />
                    </div>
                  </div>
                  <span className="text-[10px] text-white bg-black/50 px-2 py-0.5 rounded mt-1 backdrop-blur-sm">
                    {d.name || 'Driver'}
                  </span>
                </div>
              ))}

              {/* Simulated Orders */}
              {safeOrders.map((o, i) => (
                <div key={o.id} className="absolute" style={{ top: `${20 + i * 5}%`, left: `${50 + i * 8}%` }}>
                  <MapPin
                    size={24}
                    className="text-red-500 drop-shadow-xl hover:scale-110 transition-transform cursor-pointer"
                    title={o.deliveryAddressSnapshot?.fullAddress || 'Order'}
                  />
                </div>
              ))}

              {/* Map Controls Overlay */}
              <div className="absolute bottom-6 right-6 flex flex-col gap-2">
                <button className="glass-button p-2 rounded-lg" title="Center map">
                  <Navigation size={18} />
                </button>
                <button className="glass-button p-2 rounded-lg font-bold" title="Zoom in">
                  +
                </button>
                <button className="glass-button p-2 rounded-lg font-bold" title="Zoom out">
                  -
                </button>
              </div>

              <div className="absolute top-6 left-6 glass px-4 py-2 rounded-lg text-xs text-gray-400">
                Live Updates: <span className="text-green-400 font-bold">Active</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
