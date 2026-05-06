// src/views/03-Finance/AssetAndLoan.js
import React, { useEffect, useMemo, useState } from 'react';
import {
  getAssets,
  addAsset,
  getLoans,
  addLoan,
  deleteAsset,
  deleteLoan,
} from '../../api/inventoryService';
import PageTitle from '../../components/shared/PageTitle';
import Card from '../../components/shared/Card';
import Button from '../../components/shared/Button';
import Modal from '../../components/shared/Modal';
import { formatCurrency } from '../../utils/formatters';
import { PlusCircle, Trash2, Building, TrendingDown, Calculator, RefreshCw, AlertTriangle } from 'lucide-react';

export default function AssetAndLoan() {
  const [assets, setAssets] = useState([]);
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [showAssetModal, setShowAssetModal] = useState(false);
  const [showLoanModal, setShowLoanModal] = useState(false);

  const [assetForm, setAssetForm] = useState({
    name: '',
    type: 'Plant',
    cost: '',
    purchaseDate: '',
  });

  const [loanForm, setLoanForm] = useState({
    lenderName: '',
    principal: '',
    interestRate: '',
    term: '',
  });

  const safeNumber = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const itemId = (x) => x?.id || x?._id;

  const formatDateSafe = (d) => {
    if (!d) return '—';
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return '—';
    return dt.toLocaleDateString();
  };

  // Straight-line depreciation approximation (15% p.a.)
  // Defensive: if purchaseDate invalid, return original cost
  const calculateBookValue = (cost, purchaseDate) => {
    const c = safeNumber(cost);

    const d = purchaseDate ? new Date(purchaseDate) : null;
    if (!d || Number.isNaN(d.getTime())) return c;

    const years = Math.max(0, (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 365));
    const depreciationRate = 0.15;
    const value = c * (1 - depreciationRate * years);
    return Math.max(0, value);
  };

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      const [a, l] = await Promise.all([getAssets(), getLoans()]);
      setAssets(Array.isArray(a) ? a : []);
      setLoans(Array.isArray(l) ? l : []);
    } catch (e) {
      console.error(e);
      setError(e?.message || 'Failed to load assets/loans.');
      setAssets([]);
      setLoans([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const totalBookValue = useMemo(() => {
    return assets.reduce((sum, a) => sum + calculateBookValue(a?.cost, a?.purchaseDate), 0);
  }, [assets]);

  const totalOriginalCost = useMemo(() => {
    return assets.reduce((sum, a) => sum + safeNumber(a?.cost), 0);
  }, [assets]);

  const totalLoansPrincipal = useMemo(() => {
    return loans.reduce((sum, l) => sum + safeNumber(l?.principal), 0);
  }, [loans]);

  const totalMonthlyInterest = useMemo(() => {
    return loans.reduce((sum, l) => {
      const p = safeNumber(l?.principal);
      const r = safeNumber(l?.interestRate) / 100;
      if (p <= 0 || r <= 0) return sum;
      return sum + (p * r) / 12;
    }, 0);
  }, [loans]);

  const debtToAssetRatio = useMemo(() => {
    if (totalBookValue <= 0) return 0;
    return (totalLoansPrincipal / totalBookValue) * 100;
  }, [totalLoansPrincipal, totalBookValue]);

  const resetAssetForm = () => {
    setAssetForm({ name: '', type: 'Plant', cost: '', purchaseDate: '' });
  };

  const resetLoanForm = () => {
    setLoanForm({ lenderName: '', principal: '', interestRate: '', term: '' });
  };

  const handleAddAsset = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const payload = {
        ...assetForm,
        cost: safeNumber(assetForm.cost),
        purchaseDate: assetForm.purchaseDate,
      };

      await addAsset(payload);
      setShowAssetModal(false);
      resetAssetForm();
      await fetchData();
    } catch (err) {
      console.error(err);
      setError(err?.message || 'Failed to save asset.');
    } finally {
      setLoading(false);
    }
  };

  const handleAddLoan = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const payload = {
        ...loanForm,
        principal: safeNumber(loanForm.principal),
        interestRate: safeNumber(loanForm.interestRate),
        term: safeNumber(loanForm.term),
      };

      await addLoan(payload);
      setShowLoanModal(false);
      resetLoanForm();
      await fetchData();
    } catch (err) {
      console.error(err);
      setError(err?.message || 'Failed to save loan.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id, type) => {
    if (!id) return;
    if (!window.confirm('Delete item?')) return;

    setLoading(true);
    setError('');
    try {
      if (type === 'asset') await deleteAsset(id);
      else await deleteLoan(id);

      await fetchData();
    } catch (err) {
      console.error(err);
      setError(err?.message || `Failed to delete ${type}.`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <PageTitle title="Balance Sheet Management" subtitle="Assets, Depreciation & Liability Tracking" />
        <div className="print:hidden">
          <Button size="sm" variant="secondary" icon={RefreshCw} onClick={fetchData} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="glass-card border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200 flex items-center gap-2">
          <AlertTriangle size={16} className="text-red-300" />
          {error}
        </div>
      ) : null}

      {/* Portfolio summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="glass-card p-4">
          <div className="text-xs text-gray-400">Assets (Original Cost)</div>
          <div className="text-lg font-bold text-white mt-1">{formatCurrency(totalOriginalCost)}</div>
        </Card>
        <Card className="glass-card p-4">
          <div className="text-xs text-gray-400">Assets (Book Value)</div>
          <div className="text-lg font-bold text-green-300 mt-1">{formatCurrency(totalBookValue)}</div>
        </Card>
        <Card className="glass-card p-4">
          <div className="text-xs text-gray-400">Loan Principal</div>
          <div className="text-lg font-bold text-red-300 mt-1">{formatCurrency(totalLoansPrincipal)}</div>
        </Card>
        <Card className="glass-card p-4">
          <div className="text-xs text-gray-400">Debt / Asset Ratio</div>
          <div className={`text-lg font-bold mt-1 ${debtToAssetRatio > 100 ? 'text-red-300' : 'text-blue-300'}`}>
            {debtToAssetRatio.toFixed(1)}%
          </div>
        </Card>
      </div>

      {/* Assets Table with Depreciation */}
      <Card>
        <div className="flex justify-between items-center mb-6">
          <h3 className="font-bold text-white flex items-center">
            <Building className="mr-2 text-blue-400" /> Fixed Asset Register
          </h3>
          <Button size="sm" onClick={() => setShowAssetModal(true)} icon={PlusCircle}>
            Add Asset
          </Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-gray-400">
            <thead className="bg-white/5 text-gray-300">
              <tr>
                <th className="p-3">Asset</th>
                <th className="p-3">Type</th>
                <th className="p-3">Purchase Date</th>
                <th className="p-3 text-right">Original Cost</th>
                <th className="p-3 text-right">Current Book Value</th>
                <th className="p-3 text-right">Action</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-white/5">
              {assets.length === 0 && (
                <tr>
                  <td className="p-4 text-center text-gray-500" colSpan={6}>
                    {loading ? 'Loading assets…' : 'No assets recorded yet.'}
                  </td>
                </tr>
              )}

              {assets.map((a) => {
                const id = itemId(a);
                const bookVal = calculateBookValue(a?.cost, a?.purchaseDate);

                return (
                  <tr key={id || `${a?.name}-${a?.purchaseDate}`} className="hover:bg-white/5">
                    <td className="p-3 font-medium text-white">{a?.name || '—'}</td>
                    <td className="p-3">{a?.type || '—'}</td>
                    <td className="p-3">{formatDateSafe(a?.purchaseDate)}</td>
                    <td className="p-3 text-right">{formatCurrency(safeNumber(a?.cost))}</td>
                    <td className="p-3 text-right font-bold text-green-400">{formatCurrency(bookVal)}</td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() => handleDelete(id, 'asset')}
                        title="Delete asset"
                        className="inline-flex items-center justify-center"
                        disabled={loading}
                      >
                        <Trash2 size={16} className="text-red-400" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-4 p-3 bg-blue-900/20 border border-blue-500/30 rounded text-xs text-blue-300 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center">
            <Calculator size={14} className="mr-2" />
            <span>
              Values calculated using <strong>15% straight-line</strong> depreciation (approx).
            </span>
          </div>

          <div className="text-right">
            <div>
              Total Original Cost: <strong>{formatCurrency(totalOriginalCost)}</strong>
            </div>
            <div>
              Total Book Value: <strong>{formatCurrency(totalBookValue)}</strong>
            </div>
          </div>
        </div>
      </Card>

      {/* Loans Table with Interest Calc */}
      <Card>
        <div className="flex justify-between items-center mb-6">
          <h3 className="font-bold text-white flex items-center">
            <TrendingDown className="mr-2 text-red-400" /> Long Term Liabilities
          </h3>
          <Button size="sm" onClick={() => setShowLoanModal(true)} icon={PlusCircle} variant="secondary">
            Record Loan
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {loans.length === 0 && (
            <div className="p-4 bg-white/5 border border-white/10 rounded-xl text-gray-500">
              {loading ? 'Loading loans…' : 'No loans recorded yet.'}
            </div>
          )}

          {loans.map((l) => {
            const id = itemId(l);
            const principal = safeNumber(l?.principal);
            const apr = safeNumber(l?.interestRate);
            const monthlyInterest = principal > 0 && apr > 0 ? (principal * (apr / 100)) / 12 : 0;

            return (
              <div
                key={id || `${l?.lenderName}-${l?.principal}`}
                className="p-4 bg-white/5 border border-white/10 rounded-xl hover:border-red-500/50 transition-all"
              >
                <div className="flex justify-between mb-2">
                  <h4 className="font-bold text-white">{l?.lenderName || '—'}</h4>
                  <span className="text-xs bg-red-500/20 text-red-300 px-2 py-1 rounded">
                    {apr.toFixed(2)}% APR
                  </span>
                </div>

                <div className="space-y-1 text-sm">
                  <div className="flex justify-between text-gray-400">
                    <span>Principal</span>
                    <span className="text-white">{formatCurrency(principal)}</span>
                  </div>

                  <div className="flex justify-between text-gray-400">
                    <span>Term</span>
                    <span className="text-white">{safeNumber(l?.term)} Years</span>
                  </div>

                  <div className="flex justify-between text-gray-400 pt-2 border-t border-white/10">
                    <span>Est. Monthly Interest</span>
                    <span className="text-red-400">{formatCurrency(monthlyInterest)}</span>
                  </div>

                  <div className="flex justify-end pt-3">
                    <button
                      onClick={() => handleDelete(id, 'loan')}
                      className="inline-flex items-center text-xs text-red-300 hover:text-red-200"
                      title="Delete loan"
                      disabled={loading}
                    >
                      <Trash2 size={14} className="mr-1" />
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-4 p-3 bg-red-900/10 border border-red-500/20 rounded text-xs text-red-200 flex items-center justify-between gap-3 flex-wrap">
          <div>
            Total Loan Principal: <strong>{formatCurrency(totalLoansPrincipal)}</strong>
          </div>
          <div>
            Total Est. Monthly Interest: <strong>{formatCurrency(totalMonthlyInterest)}</strong>
          </div>
        </div>
      </Card>

      {/* Asset Modal */}
      {showAssetModal && (
        <Modal
          title="Add Asset"
          onClose={() => {
            setShowAssetModal(false);
            resetAssetForm();
          }}
        >
          <form onSubmit={handleAddAsset} className="space-y-4">
            <input
              className="glass-input w-full p-2"
              placeholder="Name"
              value={assetForm.name}
              onChange={(e) => setAssetForm({ ...assetForm, name: e.target.value })}
              required
            />

            <select
              className="glass-input w-full p-2 bg-slate-800"
              value={assetForm.type}
              onChange={(e) => setAssetForm({ ...assetForm, type: e.target.value })}
            >
              <option value="Plant">Plant</option>
              <option value="Vehicle">Vehicle</option>
              <option value="Equipment">Equipment</option>
              <option value="Office">Office</option>
            </select>

            <input
              type="number"
              className="glass-input w-full p-2"
              placeholder="Cost"
              value={assetForm.cost}
              onChange={(e) => setAssetForm({ ...assetForm, cost: e.target.value })}
              min="0"
              step="0.01"
              required
            />

            <input
              type="date"
              className="glass-input w-full p-2"
              value={assetForm.purchaseDate}
              onChange={(e) => setAssetForm({ ...assetForm, purchaseDate: e.target.value })}
              required
            />

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setShowAssetModal(false);
                  resetAssetForm();
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                Save
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Loan Modal */}
      {showLoanModal && (
        <Modal
          title="Record Loan"
          onClose={() => {
            setShowLoanModal(false);
            resetLoanForm();
          }}
        >
          <form onSubmit={handleAddLoan} className="space-y-4">
            <input
              className="glass-input w-full p-2"
              placeholder="Lender"
              value={loanForm.lenderName}
              onChange={(e) => setLoanForm({ ...loanForm, lenderName: e.target.value })}
              required
            />

            <input
              className="glass-input w-full p-2"
              type="number"
              placeholder="Principal"
              value={loanForm.principal}
              onChange={(e) => setLoanForm({ ...loanForm, principal: e.target.value })}
              min="0"
              step="0.01"
              required
            />

            <input
              className="glass-input w-full p-2"
              type="number"
              placeholder="Interest %"
              value={loanForm.interestRate}
              onChange={(e) => setLoanForm({ ...loanForm, interestRate: e.target.value })}
              min="0"
              step="0.01"
              required
            />

            <input
              className="glass-input w-full p-2"
              type="number"
              placeholder="Term (Years)"
              value={loanForm.term}
              onChange={(e) => setLoanForm({ ...loanForm, term: e.target.value })}
              min="0"
              step="1"
              required
            />

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setShowLoanModal(false);
                  resetLoanForm();
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                Save
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
