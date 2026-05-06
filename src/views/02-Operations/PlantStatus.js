// src/views/02-Operations/PlantStatus.js
import React, { useState, useEffect } from 'react';
import { getPlants, addMaintenanceLog } from '../../api/operationsService';
import PageTitle from '../../components/shared/PageTitle';
import Card from '../../components/shared/Card';
import Button from '../../components/shared/Button';
import Modal from '../../components/shared/Modal';
import { Factory, Wrench, AlertTriangle, RefreshCw } from 'lucide-react';

const safeNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const formatDate = (d) => {
  try {
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return '—';
    return dt.toLocaleDateString();
  } catch {
    return '—';
  }
};

// --- Maintenance Modal ---
const AddMaintenanceModal = ({ plantId, onClose, onRefresh }) => {
  const [form, setForm] = useState({ type: 'Routine', description: '', cost: '', performedBy: '' });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    // reset each time modal opens for a new plant
    setForm({ type: 'Routine', description: '', cost: '', performedBy: '' });
    setErr('');
  }, [plantId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr('');

    const cost = safeNum(form.cost, NaN);
    if (!form.description?.trim()) return setErr('Description is required.');
    if (!Number.isFinite(cost) || cost < 0) return setErr('Cost must be a valid number.');

    setSubmitting(true);
    try {
      await addMaintenanceLog(plantId, {
        type: form.type,
        description: form.description.trim(),
        cost,
        performedBy: form.performedBy?.trim() || '',
        startDate: new Date(),
      });
      await onRefresh();
      onClose();
    } catch (e2) {
      console.error('Maintenance log failed', e2);
      setErr(e2?.response?.data?.message || e2?.message || 'Failed to log maintenance.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title="Log Maintenance" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {err ? (
          <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/20 p-2 rounded">
            {err}
          </div>
        ) : null}

        <select
          className="glass-input w-full p-2 bg-slate-800"
          value={form.type}
          onChange={(e) => setForm({ ...form, type: e.target.value })}
        >
          <option>Routine</option>
          <option>Repair</option>
          <option>Emergency</option>
        </select>

        <textarea
          placeholder="Description of work..."
          className="glass-input w-full p-2 h-24"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          required
        />

        <input
          type="number"
          placeholder="Cost (₦)"
          className="glass-input w-full p-2"
          value={form.cost}
          onChange={(e) => setForm({ ...form, cost: e.target.value })}
          required
        />

        <input
          placeholder="Performed By"
          className="glass-input w-full p-2"
          value={form.performedBy}
          onChange={(e) => setForm({ ...form, performedBy: e.target.value })}
        />

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Saving...' : 'Save Log'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

// --- Main View ---
export default function PlantStatus() {
  const [plants, setPlants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncError, setSyncError] = useState('');

  const [selectedPlant, setSelectedPlant] = useState(null);

  const refresh = async () => {
    setLoading(true);
    setSyncError('');
    try {
      const data = await getPlants();
      setPlants(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Plant telemetry load failed', e);
      setSyncError(e?.response?.data?.message || e?.message || 'Failed to load plant telemetry.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return <div className="p-8 text-center text-gray-500">Loading Telemetry...</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <PageTitle title="Plant Performance" subtitle="Operational health & maintenance logs" />
        <Button onClick={refresh} variant="secondary" icon={RefreshCw}>
          Refresh
        </Button>
      </div>

      {syncError ? (
        <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-xl text-red-200 text-sm">
          <div className="flex items-start">
            <AlertTriangle className="text-red-400 mr-3 mt-0.5" size={18} />
            <div>
              <p className="font-bold">Telemetry Error</p>
              <p className="text-xs mt-1 opacity-90">{syncError}</p>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {plants.length === 0 ? (
          <div className="glass-card p-6 text-center text-gray-400 md:col-span-2 lg:col-span-3">
            No plants configured yet.
          </div>
        ) : (
          plants.map((plant) => {
            const load = Math.max(0, Math.min(100, safeNum(plant.currentLoad, 0)));
            const outputToday = safeNum(plant.outputToday, 0);

            return (
              <div
                key={plant.id || plant._id}
                className={`glass-card border-l-4 ${
                  plant.status === 'Operational' ? 'border-green-500' : 'border-red-500'
                }`}
              >
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center">
                    <div
                      className={`p-3 rounded-xl mr-4 ${
                        plant.status === 'Operational'
                          ? 'bg-green-500/20 text-green-400'
                          : 'bg-red-500/20 text-red-400'
                      }`}
                    >
                      <Factory size={24} />
                    </div>
                    <div>
                      <h3 className="font-bold text-white text-lg">{plant.name}</h3>
                      <p className="text-xs text-gray-400">{plant.location || '—'}</p>
                    </div>
                  </div>

                  <button
                    onClick={() => setSelectedPlant(plant.id || plant._id)}
                    className="text-xs flex items-center bg-blue-600/20 text-blue-300 px-2 py-1 rounded hover:bg-blue-600/40"
                  >
                    <Wrench size={12} className="mr-1" /> Log Fix
                  </button>
                </div>

                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-xs text-gray-400 mb-1">
                      <span>Load</span>
                      <span>{load}%</span>
                    </div>
                    <div className="w-full bg-gray-700 rounded-full h-1.5">
                      <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${load}%` }}></div>
                    </div>
                  </div>

                  <div className="flex justify-between items-center text-sm pt-2">
                    <span className="text-gray-400">Output Today</span>
                    <span className="text-white font-mono">{outputToday.toLocaleString()} kg</span>
                  </div>

                  {Array.isArray(plant.maintenanceLogs) && plant.maintenanceLogs.length > 0 ? (
                    <div className="pt-2 border-t border-white/10">
                      <p className="text-xs text-gray-400 mb-1">Last Maintenance</p>
                      <p className="text-xs text-gray-300">
                        {plant.maintenanceLogs[0]?.type || '—'} • {formatDate(plant.maintenanceLogs[0]?.startDate)}
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>

      {selectedPlant ? (
        <AddMaintenanceModal plantId={selectedPlant} onClose={() => setSelectedPlant(null)} onRefresh={refresh} />
      ) : null}
    </div>
  );
}
