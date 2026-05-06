// src/views/02-Operations/Logistics.js (Hardened & Aligned)

import React, { useState, useEffect, useCallback, useMemo } from 'react';

import {
  getVans,            // ✅ must exist in operationsService (see note below)
  getOnlineDrivers,   // ✅ already exists in your operationsservice.js
} from '../../api/operationsService';

import {
  getUnassignedOrders,
  assignDriverToRun,
  getActiveRuns,
  getRunDetails,
  getDriverRunHistory,
} from '../../api/runService';

import { getDriverStats } from '../../api/userService';
import { formatCurrency, formatDate } from '../../utils/formatters';

import PageTitle from '../../components/shared/PageTitle';
import Card from '../../components/shared/Card';
import Button from '../../components/shared/Button';
import Modal from '../../components/shared/Modal';
import Notification from '../../components/shared/Notification';

import {
  MapPin,
  Truck,
  ClipboardList,
  CheckCircle,
  User,
  History,
  Star,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';

// -------------------- utils --------------------
const getId = (x) => x?.id || x?._id || '';
const safeText = (v, fallback = 'N/A') => (v === null || v === undefined || v === '' ? fallback : String(v));
const parseErr = (e, fallback = 'Something went wrong.') =>
  e?.response?.data?.message || e?.message || fallback;

// -------------------- Run Details Modal --------------------
const RunDetailsModal = ({ run, onClose }) => {
  const runId = getId(run);
  return (
    <Modal title={`Run Details: ${runId ? `${runId.substring(0, 8)}...` : '—'}`} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p><strong>Status:</strong> {safeText(run?.overallStatus, '—')}</p>
        <p>
          <strong>Driver:</strong> {safeText(run?.driver?.name)} ({safeText(run?.driver?.email)})
        </p>
        <p><strong>Total Stops:</strong> {safeText(run?.totalStops, 0)}</p>
        <p><strong>Completed Stops:</strong> {safeText(run?.completedStops, 0)}</p>
        <p><strong>Start Date:</strong> {formatDate(run?.actualStartDate || run?.estimatedStartDate)}</p>
        {run?.actualCompletionDate && (
          <p><strong>Completion Date:</strong> {formatDate(run.actualCompletionDate)}</p>
        )}

        <h4 className="font-semibold mt-4 mb-2 border-b pb-1">Stops</h4>
        {Array.isArray(run?.stops) && run.stops.length > 0 ? (
          <ul className="list-disc list-inside space-y-2">
            {run.stops.map((stop) => {
              const stopKey = stop?.stopId || stop?.id || `${getId(stop?.order)}-${stop?.status}`;
              const orderId = getId(stop?.order);
              return (
                <li key={stopKey} className="bg-gray-50 p-2 rounded-md">
                  <p>
                    <strong>Order:</strong> {orderId ? `${orderId.substring(0, 8)}...` : '—'} (
                    {safeText(stop?.order?.recipientName, '—')})
                  </p>
                  <p className="ml-4 text-xs">
                    Address: {safeText(stop?.order?.deliveryAddressSnapshot?.fullAddress, '—')}
                  </p>
                  <p className="ml-4 text-xs">Status: {safeText(stop?.status, '—')}</p>
                </li>
              );
            })}
          </ul>
        ) : (
          <p>No stops found for this run.</p>
        )}
      </div>
    </Modal>
  );
};

// -------------------- Driver Performance Card --------------------
const DriverPerformanceCard = ({ driver, onShowHistory, onError }) => {
  const [stats, setStats] = useState(null);
  const [loadingStats, setLoadingStats] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      setLoadingStats(true);
      try {
        const driverStats = await getDriverStats(driver.id);
        setStats(driverStats);
      } catch (error) {
        console.error(`Failed to fetch stats for driver ${driver.id}:`, error);
        onError?.(parseErr(error, 'Failed to load driver stats.'));
      } finally {
        setLoadingStats(false);
      }
    };

    if (driver?.id) fetchStats();
  }, [driver?.id, onError]);

  const avgRating = Number(stats?.averageRating);
  const avgDelivery = Number(stats?.averageDeliveryTimeMinutes);

  return (
    <Card>
      <h3 className="text-lg font-semibold text-gray-700 mb-4 flex items-center">
        <User className="mr-2 text-blue-500" />
        {safeText(driver.name, 'Driver')}
      </h3>
      <p className="text-sm text-gray-500 mb-2">{safeText(driver.email || driver.phone, '')}</p>
      <p className="text-xs text-gray-500">Van: {safeText(driver.vanNumber, 'N/A')}</p>

      {loadingStats ? (
        <p className="text-sm text-gray-500">Loading stats...</p>
      ) : stats ? (
        <div className="grid grid-cols-2 gap-4 mt-4 text-sm">
          <div>
            <p className="text-xs text-gray-500 uppercase">Orders Executed</p>
            <p className="font-bold text-lg">{stats.totalOrdersExecuted ?? 0}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase">Total Revenue</p>
            <p className="font-bold text-lg">{formatCurrency(stats.totalRevenueMade ?? 0)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase">Avg Rating</p>
            <p className="font-bold text-lg flex items-center">
              {Number.isFinite(avgRating) ? avgRating.toFixed(1) : '—'}{' '}
              <Star size={16} className="ml-1 text-yellow-500" />
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase">Avg Delivery Time</p>
            <p className="font-bold text-lg">
              {Number.isFinite(avgDelivery) ? `${avgDelivery.toFixed(0)} min` : '—'}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-gray-500 mt-4">No stats available.</p>
      )}

      <div className="mt-4 border-t pt-4">
        <Button onClick={() => onShowHistory(driver.id, driver.name)} variant="secondary" size="sm" icon={History}>
          View Run History
        </Button>
      </div>
    </Card>
  );
};

// -------------------- Driver Run History Modal --------------------
const DriverRunHistoryModal = ({ driverId, driverName, onClose, onError }) => {
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const fetchHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const result = await getDriverRunHistory(driverId, { page, limit: 10 });
      setHistory(Array.isArray(result?.runs) ? result.runs : []);
      setTotalPages(result?.totalPages || 1);
    } catch (error) {
      console.error(`Failed to fetch run history for ${driverId}:`, error);
      onError?.(parseErr(error, 'Failed to load driver run history.'));
    } finally {
      setLoadingHistory(false);
    }
  }, [driverId, page, onError]);

  useEffect(() => {
    if (driverId) fetchHistory();
  }, [fetchHistory, driverId]);

  return (
    <Modal title={`Run History: ${driverName}`} onClose={onClose}>
      {loadingHistory ? (
        <p className="text-center p-4">Loading history...</p>
      ) : history.length > 0 ? (
        <div className="overflow-x-auto max-h-96">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="p-2">Run ID</th>
                <th className="p-2">Date</th>
                <th className="p-2">Status</th>
                <th className="p-2">Stops</th>
                <th className="p-2">Completed</th>
              </tr>
            </thead>
            <tbody>
              {history.map((run) => {
                const rid = getId(run);
                return (
                  <tr key={rid} className="border-b hover:bg-gray-50">
                    <td className="p-2">{rid ? `${rid.substring(0, 8)}...` : '—'}</td>
                    <td className="p-2">{formatDate(run.actualCompletionDate || run.actualStartDate)}</td>
                    <td className="p-2">{safeText(run.overallStatus, '—')}</td>
                    <td className="p-2">{run.totalStops ?? 0}</td>
                    <td className="p-2">{run.completedStops ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="flex justify-between items-center mt-4">
            <Button onClick={() => setPage((prev) => prev - 1)} disabled={page <= 1 || loadingHistory} icon={ChevronLeft}>
              Previous
            </Button>
            <span>Page {page} of {totalPages}</span>
            <Button onClick={() => setPage((prev) => prev + 1)} disabled={page >= totalPages || loadingHistory} icon={ChevronRight}>
              Next
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-gray-500 text-center p-4">No run history found for this driver.</p>
      )}
    </Modal>
  );
};

// -------------------- Main Logistics View --------------------
export default function Logistics() {
  const [vans, setVans] = useState([]);
  const [drivers, setDrivers] = useState([]); // ✅ real drivers, not vans-as-drivers
  const [orders, setOrders] = useState([]);
  const [activeRuns, setActiveRuns] = useState([]);
  const [loading, setLoading] = useState(true);

  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [selectedDriverId, setSelectedDriverId] = useState('');

  const [notification, setNotification] = useState({ show: false, message: '', type: 'success' });
  const [activeTab, setActiveTab] = useState('assignment');

  const [selectedRunDetails, setSelectedRunDetails] = useState(null);
  const [selectedDriverForHistory, setSelectedDriverForHistory] = useState(null);

  const [assigning, setAssigning] = useState(false);

  const notify = useCallback((message, type = 'success') => {
    setNotification({ show: true, message, type });
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [fetchedVans, fetchedOrders, fetchedActiveRuns, fetchedDrivers] = await Promise.all([
        getVans(),
        getUnassignedOrders(),
        getActiveRuns(),
        getOnlineDrivers(), // ✅ use your existing operation service
      ]);

      setVans(Array.isArray(fetchedVans) ? fetchedVans : []);
      setOrders(Array.isArray(fetchedOrders) ? fetchedOrders : []);
      setActiveRuns(Array.isArray(fetchedActiveRuns) ? fetchedActiveRuns : []);
      setDrivers(Array.isArray(fetchedDrivers) ? fetchedDrivers : []);
    } catch (error) {
      console.error('Failed to fetch logistics data:', error);
      notify(parseErr(error, 'Failed to load logistics data.'), 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Defaults
  useEffect(() => {
    if (orders.length > 0 && !selectedOrderId) setSelectedOrderId(getId(orders[0]));
    if (orders.length === 0) setSelectedOrderId('');
  }, [orders, selectedOrderId]);

  useEffect(() => {
    if (drivers.length > 0 && !selectedDriverId) setSelectedDriverId(getId(drivers[0]));
    if (drivers.length === 0) setSelectedDriverId('');
  }, [drivers, selectedDriverId]);

  // Badge
  const StatusBadge = ({ status }) => {
    const colors = {
      Idle: 'bg-green-100 text-green-800',
      'On Delivery': 'bg-blue-100 text-blue-800',
      Returning: 'bg-yellow-100 text-yellow-800',
      Maintenance: 'bg-orange-100 text-orange-800',
      Offline: 'bg-red-100 text-red-800',
    };
    return (
      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${colors[status] || 'bg-gray-100 text-gray-800'}`}>
        {safeText(status, 'Unknown')}
      </span>
    );
  };

  const idleVans = useMemo(() => vans.filter((v) => v.status === 'Idle'), [vans]);

  /**
   * ✅ FIXED: This must assign a *driver* to an *order/run* depending on backend design.
   * Your runService signature:
   *   assignDriverToRun(runId, driverId)
   *
   * Your UI is currently selecting an "unassigned order".
   * Your backend endpoint is /runs/admin/unassigned-orders so these are still "orders",
   * but the assign endpoint is /runs/{runId}/assign-driver — meaning backend expects runId.
   *
   * Therefore: unassigned list must contain a "runId" or "id that represents run".
   * We'll treat selectedOrderId as the runId if that's how your backend returns it.
   */
  const handleAssignRun = async () => {
    if (!selectedOrderId || !selectedDriverId) {
      notify('Please select an order/run and an available driver.', 'error');
      return;
    }

    setAssigning(true);
    try {
      await assignDriverToRun(selectedOrderId, selectedDriverId);
      notify(`Assigned ${selectedOrderId.substring(0, 8)}... to driver ${selectedDriverId.substring(0, 8)}...`, 'success');
      await fetchData();
    } catch (error) {
      console.error('Assignment Error:', error);
      notify(parseErr(error, 'Failed to assign run.'), 'error');
    } finally {
      setAssigning(false);
    }
  };

  const handleViewRunDetails = async (runId) => {
    if (!runId) return;
    try {
      const details = await getRunDetails(runId);
      setSelectedRunDetails(details);
    } catch (error) {
      console.error('Failed to fetch run details:', error);
      notify(parseErr(error, 'Failed to load run details.'), 'error');
    }
  };

  const handleShowDriverHistory = (driverId, driverName) => {
    setSelectedDriverForHistory({ id: driverId, name: driverName });
  };

  return (
    <>
      <Notification notification={notification} setNotification={setNotification} />

      {selectedRunDetails ? (
        <RunDetailsModal run={selectedRunDetails} onClose={() => setSelectedRunDetails(null)} />
      ) : null}

      {selectedDriverForHistory ? (
        <DriverRunHistoryModal
          driverId={selectedDriverForHistory.id}
          driverName={selectedDriverForHistory.name}
          onClose={() => setSelectedDriverForHistory(null)}
          onError={(msg) => notify(msg, 'error')}
        />
      ) : null}

      <div className="flex justify-between items-center">
        <PageTitle title="Logistics & Dispatch Hub" subtitle="Monitor your delivery fleet and assign runs in real-time." />
        <Button onClick={fetchData} variant="secondary" icon={RefreshCw} disabled={loading}>
          Refresh
        </Button>
      </div>

      <Card className="mb-6">
        <div className="border-b border-gray-200 mb-6">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('assignment')}
              className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'assignment'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Run Assignment
            </button>
            <button
              onClick={() => setActiveTab('performance')}
              className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'performance'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Driver Performance & History
            </button>
          </nav>
        </div>

        {activeTab === 'assignment' ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* LEFT */}
            <div className="lg:col-span-2 space-y-6">
              <Card>
                <h3 className="text-lg font-semibold text-gray-700 mb-4 flex items-center">
                  <MapPin className="mr-2" /> Fleet Map
                </h3>
                <div className="bg-gray-200 h-96 rounded-md flex items-center justify-center">
                  <p className="text-gray-500">Live map integration will be here.</p>
                </div>
              </Card>

              <Card>
                <h3 className="text-lg font-semibold text-gray-700 mb-4 flex items-center">
                  <Truck className="mr-2" /> Van Status
                </h3>

                {loading ? (
                  <p>Loading van status...</p>
                ) : vans.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {vans.map((van) => {
                      const vid = getId(van);
                      return (
                        <div key={vid} className="border p-3 rounded-lg flex justify-between items-center">
                          <div>
                            <p className="font-bold">
                              {`Van ${safeText(van.vanNumber, '—')}`}
                              <span className="font-normal text-gray-600 text-sm">
                                {' '}
                                - {safeText(van.driverName, 'Unassigned')}
                              </span>
                            </p>
                            <p className="text-sm text-gray-500">
                              {van.status === 'Idle'
                                ? safeText(van.location, 'Depot')
                                : safeText(van.destination, 'Unknown Destination')}
                            </p>
                          </div>
                          <StatusBadge status={van.status} />
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-md text-sm text-yellow-800 flex items-start">
                    <AlertTriangle className="mr-2 mt-0.5" size={16} />
                    <span>No vans found. Confirm your vans endpoint and permissions.</span>
                  </div>
                )}
              </Card>

              <Card>
                <h3 className="text-lg font-semibold text-gray-700 mb-4 flex items-center">
                  <ClipboardList className="mr-2" /> Active Delivery Runs
                </h3>

                {loading ? (
                  <p>Loading active runs...</p>
                ) : activeRuns.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b bg-gray-50">
                          <th className="p-2">Run ID</th>
                          <th className="p-2">Driver</th>
                          <th className="p-2">Status</th>
                          <th className="p-2">Stops</th>
                          <th className="p-2">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeRuns.map((run) => {
                          const rid = getId(run);
                          return (
                            <tr key={rid} className="border-b hover:bg-gray-50">
                              <td className="p-2">{rid ? `${rid.substring(0, 8)}...` : '—'}</td>
                              <td className="p-2">{safeText(run.driver?.name, 'N/A')}</td>
                              <td className="p-2">{safeText(run.overallStatus, '—')}</td>
                              <td className="p-2">{(run.completedStops ?? 0)}/{(run.totalStops ?? 0)}</td>
                              <td className="p-2">
                                <Button onClick={() => handleViewRunDetails(rid)} variant="secondary" size="sm">
                                  View
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-gray-500">No active runs.</p>
                )}
              </Card>
            </div>

            {/* RIGHT */}
            <div className="lg:col-span-1">
              <Card>
                <h3 className="text-lg font-semibold text-gray-700 mb-4 flex items-center">
                  <ClipboardList className="mr-2" /> Assign Delivery Run
                </h3>

                {loading ? (
                  <p>Loading assignment data...</p>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <label htmlFor="select-order" className="block text-sm font-medium text-gray-700">
                        1. Select Unassigned Order/Run
                      </label>
                      <select
                        id="select-order"
                        value={selectedOrderId}
                        onChange={(e) => setSelectedOrderId(e.target.value)}
                        className="mt-1 w-full p-2 border rounded-md bg-white"
                      >
                        {orders.length > 0 ? (
                          orders.map((order) => {
                            const oid = getId(order);
                            return (
                              <option key={oid} value={oid}>
                                {`${oid.substring(0, 8)} - ${safeText(order.recipientName, '—')} (${safeText(order.deliveryAddressSnapshot?.city, 'N/A')})`}
                              </option>
                            );
                          })
                        ) : (
                          <option value="">No unassigned orders</option>
                        )}
                      </select>
                    </div>

                    <div>
                      <label htmlFor="select-driver" className="block text-sm font-medium text-gray-700">
                        2. Select Available Driver
                      </label>
                      <select
                        id="select-driver"
                        value={selectedDriverId}
                        onChange={(e) => setSelectedDriverId(e.target.value)}
                        className="mt-1 w-full p-2 border rounded-md bg-white"
                      >
                        {drivers.length > 0 ? (
                          drivers.map((d) => {
                            const did = getId(d);
                            return (
                              <option key={did} value={did}>
                                {`${safeText(d.name, 'Driver')} ${d.phone ? `(${d.phone})` : ''}`}
                              </option>
                            );
                          })
                        ) : (
                          <option value="">No online drivers</option>
                        )}
                      </select>
                      <p className="text-xs text-gray-500 mt-1">
                        Drivers list is sourced from <code>/users?role=driver&amp;isAvailableOnline=true</code>.
                      </p>
                    </div>

                    <div className="pt-2">
                      <Button
                        onClick={handleAssignRun}
                        disabled={!selectedOrderId || !selectedDriverId || loading || assigning}
                        icon={CheckCircle}
                        className="w-full"
                      >
                        {assigning ? 'Assigning...' : 'Assign Run'}
                      </Button>
                    </div>

                    <div className="pt-2">
                      <p className="text-xs text-gray-500">
                        Note: This assigns a <b>driver</b> to a <b>run/order id</b>. If your backend expects a real <b>runId</b>
                        (not orderId), ensure your “unassigned” list returns run IDs.
                      </p>
                    </div>
                  </div>
                )}
              </Card>
            </div>
          </div>
        ) : (
          // PERFORMANCE TAB
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {drivers.length > 0 ? (
              drivers.map((d) => {
                const did = getId(d);
                return (
                  <DriverPerformanceCard
                    key={did}
                    driver={{
                      id: did,
                      name: d.name,
                      email: d.email,
                      phone: d.phone,
                      vanNumber: d.vanNumber,
                    }}
                    onShowHistory={handleShowDriverHistory}
                    onError={(msg) => notify(msg, 'error')}
                  />
                );
              })
            ) : (
              <p className="text-gray-500 md:col-span-2 text-center p-8">
                No online drivers found.
              </p>
            )}
          </div>
        )}
      </Card>
    </>
  );
}
