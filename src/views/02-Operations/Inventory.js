// File: src/views/03-Finance/Inventory.js
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { getInventorySummary, getStockIns, getPlants } from '../../api/operationsService';
import PageTitle from '../../components/shared/PageTitle';
import Card from '../../components/shared/Card';
import Button from '../../components/shared/Button';
import { Package, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { formatCurrency, formatDate } from '../../utils/formatters';
import LogStockInModal from './LogStockInModal';

const safeNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const postingTone = (status) => {
  const s = String(status || '').toUpperCase();
  if (s === 'POSTED') return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
  if (s === 'FAILED') return 'text-red-300 bg-red-500/10 border-red-500/20';
  if (s === 'SKIPPED') return 'text-yellow-300 bg-yellow-500/10 border-yellow-500/20';
  if (s === 'QUEUED') return 'text-blue-300 bg-blue-500/10 border-blue-500/20';
  return 'text-gray-300 bg-white/5 border-white/10';
};

const PostingBadge = ({ status }) => (
  <span className={`text-[10px] px-2 py-1 rounded-full border ${postingTone(status)}`}>
    {String(status || 'UNPOSTED').toUpperCase()}
  </span>
);

export default function Inventory() {
  const [inventory, setInventory] = useState(null);
  const [stockIns, setStockIns] = useState([]);
  const [plants, setPlants] = useState([]);
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState('');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [isStockModalOpen, setIsStockModalOpen] = useState(false);

  const branchLabel = useMemo(() => {
    if (!branchId) return 'All Branches';
    const found = branches.find((b) => String(b.id) === String(branchId));
    return found?.name || `Branch ${branchId}`;
  }, [branchId, branches]);

  const fetchBranches = useCallback(async () => {
    try {
      const res = await getPlants?.();
      setPlants(Array.isArray(res) ? res : []);
      const normalized = Array.isArray(res)
        ? res
            .map((p) => ({ id: p?.id || p?._id, name: p?.name || 'Unnamed Branch' }))
            .filter((x) => x.id)
        : [];
      setBranches(normalized);
    } catch (e) {
      console.error('Failed to load plants:', e);
      setPlants([]);
      setBranches([]);
    }
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [inv, ins] = await Promise.all([
        getInventorySummary?.(branchId || undefined),
        getStockIns?.(branchId || undefined),
      ]);

      setInventory(inv || null);
      setStockIns(Array.isArray(ins) ? ins : []);
    } catch (e) {
      console.error('Inventory fetch failed:', e);
      setInventory(null);
      setStockIns([]);
      setError(e?.response?.data?.message || e?.message || 'Failed to load inventory.');
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    fetchBranches();
  }, [fetchBranches]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const currentStockKg = safeNum(
    inventory?.currentStock ?? inventory?.currentBulkLpgKg ?? inventory?.currentStockKg ?? 0
  );

  const totalCapacityKg = safeNum(
    inventory?.totalCapacity ?? inventory?.totalStockedKg ?? inventory?.capacityKg ?? 0
  );

  const stockPercent = useMemo(() => {
    if (!totalCapacityKg || totalCapacityKg <= 0) return 0;
    return Math.max(0, Math.min(100, (currentStockKg / totalCapacityKg) * 100));
  }, [currentStockKg, totalCapacityKg]);

  const closeStockModal = () => setIsStockModalOpen(false);

  const handleStockSaved = async () => {
    closeStockModal();
    await fetchData();
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <PageTitle
          title="Inventory"
          subtitle="GL-first Inventory Receipt: Stock-In posts to GL (Dr Inventory 1200 / Cr Bank or AP)"
        />
        <div className="flex gap-2">
          <Button variant="secondary" icon={RefreshCw} onClick={fetchData}>
            Refresh
          </Button>
          <Button icon={Package} onClick={() => setIsStockModalOpen(true)}>
            Log Stock-In
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="bg-white/5 border border-white/10 rounded-xl p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
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
            <p className="text-[10px] text-gray-500 mt-1">Maps to branchId / serviceZoneId</p>
          </div>

          <div className="ml-auto text-xs text-gray-400">
            Scope: <span className="text-white">{branchLabel}</span>
          </div>
        </div>
      </Card>

      {loading ? (
        <div className="p-10 text-center text-blue-400 animate-pulse">Loading inventory...</div>
      ) : error ? (
        <div className="p-10 text-center text-gray-400">
          {error}
          <div className="mt-4">
            <Button icon={RefreshCw} onClick={fetchData}>
              Retry
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="bg-white/5 border border-white/10 rounded-xl p-4">
              <div className="text-xs text-gray-400 uppercase font-semibold">Current Stock</div>
              <div className="text-2xl font-bold text-white mt-2">{currentStockKg.toLocaleString()} kg</div>
              <div className="text-[11px] text-gray-500 mt-2">As per inventory summary</div>
            </Card>

            <Card className="bg-white/5 border border-white/10 rounded-xl p-4">
              <div className="text-xs text-gray-400 uppercase font-semibold">Capacity</div>
              <div className="text-2xl font-bold text-white mt-2">{totalCapacityKg.toLocaleString()} kg</div>
              <div className="text-[11px] text-gray-500 mt-2">Configured plant capacity</div>
            </Card>

            <Card className="bg-white/5 border border-white/10 rounded-xl p-4">
              <div className="text-xs text-gray-400 uppercase font-semibold">Utilization</div>
              <div className="text-2xl font-bold text-white mt-2">{stockPercent.toFixed(0)}%</div>
              <div className="text-[11px] text-gray-500 mt-2">Current stock ÷ capacity</div>
            </Card>
          </div>

          {/* Stock In List */}
          <Card className="bg-white/5 border border-white/10 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-white flex items-center gap-2">
                <Package size={16} />
                Stock-In Receipts
              </div>
              <div className="text-[11px] text-gray-500">
                Each Stock-In should post: <span className="text-gray-300">Dr 1200 Inventory</span> /{' '}
                <span className="text-gray-300">Cr Bank or AP</span>
              </div>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-white/10 text-gray-300">
                  <tr>
                    <th className="text-left py-2">Date</th>
                    <th className="text-left py-2">Supplier</th>
                    <th className="text-right py-2">Qty (kg)</th>
                    <th className="text-right py-2">Cost/kg</th>
                    <th className="text-right py-2">Total</th>
                    <th className="text-left py-2">Posting</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {stockIns.map((s) => {
                    const dt = s.purchaseDate || s.createdAt;
                    const total = safeNum(s.quantityKg) * safeNum(s.costPerKg);
                    const postingStatus = s?.posting?.status || 'UNPOSTED';

                    return (
                      <tr key={s._id}>
                        <td className="py-2 text-gray-200">{formatDate(dt)}</td>
                        <td className="py-2 text-gray-200">{s.supplier || '—'}</td>
                        <td className="py-2 text-right text-gray-200">{safeNum(s.quantityKg).toLocaleString()}</td>
                        <td className="py-2 text-right text-gray-200">₦{safeNum(s.costPerKg).toLocaleString()}</td>
                        <td className="py-2 text-right text-white font-semibold">{formatCurrency(total)}</td>
                        <td className="py-2">
                          <div className="flex items-center gap-2">
                            <PostingBadge status={postingStatus} />
                            {postingStatus === 'FAILED' ? (
                              <span className="text-[10px] text-red-300 flex items-center gap-1">
                                <AlertTriangle size={12} />
                                {s?.posting?.errorCode || 'FAILED'}
                              </span>
                            ) : postingStatus === 'POSTED' ? (
                              <span className="text-[10px] text-emerald-300 flex items-center gap-1">
                                <CheckCircle2 size={12} />
                                OK
                              </span>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {stockIns.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-gray-500">
                        No stock-in receipts found.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {/* GL-first Stock-in modal */}
      {isStockModalOpen && (
        <LogStockInModal
          isOpen={isStockModalOpen}
          onClose={closeStockModal}
          onSaved={handleStockSaved}
          branches={branches}
          defaultBranchId={branchId}
        />
      )}
    </div>
  );
}