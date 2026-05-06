// File: src/views/03-Finance/LogStockInModal.js
import React, { useMemo, useState } from 'react';
import Button from '../../components/shared/Button';
import Card from '../../components/shared/Card';
import { X, PackagePlus, AlertTriangle } from 'lucide-react';
import { addStockIn } from '../../api/operationsService';
import { formatCurrency } from '../../utils/formatters';

const safeNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const hasVal = (v) => v !== undefined && v !== null && String(v).trim() !== '';

export default function LogStockInModal({ isOpen, onClose, onSaved, branches = [], defaultBranchId = '' }) {
  const [purchaseDate, setPurchaseDate] = useState('');
  const [branchId, setBranchId] = useState(defaultBranchId || '');
  const [supplier, setSupplier] = useState('');
  const [quantityKg, setQuantityKg] = useState('');
  const [costPerKg, setCostPerKg] = useState('');

  // Payment dimension (GL-first)
  const [paymentDisposition, setPaymentDisposition] = useState('UNPAID_AP'); // PAID_BANK | UNPAID_AP | PART_PAID
  const [amountPaid, setAmountPaid] = useState('');

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const qty = useMemo(() => safeNum(quantityKg, 0), [quantityKg]);
  const cpk = useMemo(() => safeNum(costPerKg, 0), [costPerKg]);
  const totalCost = useMemo(() => qty * cpk, [qty, cpk]);

  const paid = useMemo(() => safeNum(amountPaid, 0), [amountPaid]);
  const outstanding = useMemo(() => Math.max(0, totalCost - paid), [totalCost, paid]);

  const glPreview = useMemo(() => {
    // GL rule: Dr 1200 Inventory
    // Credit depends on paymentDisposition:
    //  - PAID_BANK => Cr 1010
    //  - UNPAID_AP => Cr 2000
    //  - PART_PAID => Cr 1010 (paid) + Cr 2000 (outstanding)
    const lines = [];

    if (totalCost <= 0) return lines;

    lines.push({ dr: '1200 Inventory - LPG', cr: null, amount: totalCost });

    if (paymentDisposition === 'PAID_BANK') {
      lines.push({ dr: null, cr: '1010 Bank - Transfers', amount: totalCost });
    } else if (paymentDisposition === 'UNPAID_AP') {
      lines.push({ dr: null, cr: '2000 Accounts Payable', amount: totalCost });
    } else if (paymentDisposition === 'PART_PAID') {
      if (paid > 0) lines.push({ dr: null, cr: '1010 Bank - Transfers', amount: Math.min(paid, totalCost) });
      if (outstanding > 0) lines.push({ dr: null, cr: '2000 Accounts Payable', amount: outstanding });
    }

    return lines;
  }, [paymentDisposition, totalCost, paid, outstanding]);

  const canSave = useMemo(() => {
    if (!hasVal(purchaseDate)) return false;
    if (!hasVal(branchId)) return false;
    if (!hasVal(supplier)) return false;
    if (qty <= 0) return false;
    if (cpk <= 0) return false;
    if (paymentDisposition === 'PART_PAID' && paid <= 0) return false;
    if (paymentDisposition === 'PAID_BANK' && totalCost <= 0) return false;
    return true;
  }, [purchaseDate, branchId, supplier, qty, cpk, paymentDisposition, paid, totalCost]);

  const handleSave = async () => {
    setErr('');
    if (!canSave) {
      setErr('Please complete all required fields (date, branch, supplier, qty, cost, payment).');
      return;
    }

    setSaving(true);
    try {
      // Keep payload tolerant; backend can ignore unknown fields safely.
      const payload = {
        purchaseDate,
        branchId,
        supplier,
        quantityKg: qty,
        costPerKg: cpk,

        // payment signals for GL posting
        paymentDisposition, // UNPAID_AP | PAID_BANK | PART_PAID
        amountPaid: paymentDisposition === 'PART_PAID' ? paid : paymentDisposition === 'PAID_BANK' ? totalCost : 0,
        isPaid: paymentDisposition === 'PAID_BANK',
        paymentStatus: paymentDisposition === 'PAID_BANK' ? 'paid' : paymentDisposition === 'PART_PAID' ? 'part_paid' : 'unpaid',
      };

      await addStockIn(payload);

      if (typeof onSaved === 'function') onSaved();
    } catch (e) {
      console.error('Stock-in save failed:', e);
      setErr(e?.response?.data?.message || e?.message || 'Failed to save stock-in.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-[#0b0f1a] border border-white/10 rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="text-white font-semibold flex items-center gap-2">
            <PackagePlus size={18} /> Log Stock-In (GL-first)
          </div>
          <button onClick={onClose} className="text-gray-300 hover:text-white">
            <X />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {err ? (
            <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl p-3 flex gap-2">
              <AlertTriangle size={16} className="mt-0.5" />
              <span>{err}</span>
            </div>
          ) : null}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400">Purchase Date *</label>
              <input
                type="date"
                className="w-full mt-1 px-3 py-2 rounded-lg bg-black/30 text-white border border-white/10"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
              />
            </div>

            <div>
              <label className="text-xs text-gray-400">Branch *</label>
              <select
                className="w-full mt-1 px-3 py-2 rounded-lg bg-black/30 text-white border border-white/10"
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
              >
                <option value="">Select branch</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="text-xs text-gray-400">Supplier *</label>
              <input
                className="w-full mt-1 px-3 py-2 rounded-lg bg-black/30 text-white border border-white/10"
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
                placeholder="e.g., NIPCO / Supplier Name"
              />
            </div>

            <div>
              <label className="text-xs text-gray-400">Quantity (kg) *</label>
              <input
                className="w-full mt-1 px-3 py-2 rounded-lg bg-black/30 text-white border border-white/10"
                value={quantityKg}
                onChange={(e) => setQuantityKg(e.target.value)}
                placeholder="e.g., 1000"
              />
            </div>

            <div>
              <label className="text-xs text-gray-400">Cost per kg (₦) *</label>
              <input
                className="w-full mt-1 px-3 py-2 rounded-lg bg-black/30 text-white border border-white/10"
                value={costPerKg}
                onChange={(e) => setCostPerKg(e.target.value)}
                placeholder="e.g., 950"
              />
            </div>

            <div className="md:col-span-2">
              <label className="text-xs text-gray-400">Payment Disposition *</label>
              <select
                className="w-full mt-1 px-3 py-2 rounded-lg bg-black/30 text-white border border-white/10"
                value={paymentDisposition}
                onChange={(e) => setPaymentDisposition(e.target.value)}
              >
                <option value="UNPAID_AP">UNPAID (Accounts Payable)</option>
                <option value="PAID_BANK">PAID (Bank Transfer)</option>
                <option value="PART_PAID">PART PAID (Split Bank + AP)</option>
              </select>
              <p className="text-[10px] text-gray-500 mt-1">
                This determines the credit leg: Bank (1010) vs Payable (2000).
              </p>
            </div>

            {paymentDisposition === 'PART_PAID' ? (
              <div className="md:col-span-2">
                <label className="text-xs text-gray-400">Amount Paid (₦) *</label>
                <input
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-black/30 text-white border border-white/10"
                  value={amountPaid}
                  onChange={(e) => setAmountPaid(e.target.value)}
                  placeholder="e.g., 250000"
                />
                <p className="text-[10px] text-gray-500 mt-1">
                  Outstanding will be posted to Accounts Payable automatically.
                </p>
              </div>
            ) : null}
          </div>

          <Card className="bg-white/5 border border-white/10 rounded-xl p-4">
            <div className="text-sm font-semibold text-white mb-2">Inventory Financial Impact (GL Preview)</div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
              <div className="p-3 rounded-xl bg-black/20 border border-white/10">
                <div className="text-[11px] text-gray-400">Total Cost</div>
                <div className="text-white font-bold">{formatCurrency(totalCost)}</div>
              </div>

              <div className="p-3 rounded-xl bg-black/20 border border-white/10">
                <div className="text-[11px] text-gray-400">Paid</div>
                <div className="text-white font-bold">{formatCurrency(paid)}</div>
              </div>

              <div className="p-3 rounded-xl bg-black/20 border border-white/10">
                <div className="text-[11px] text-gray-400">Outstanding</div>
                <div className="text-white font-bold">{formatCurrency(outstanding)}</div>
              </div>
            </div>

            <div className="text-[11px] text-gray-400 mb-2">Journal Lines</div>
            <div className="space-y-2">
              {glPreview.length === 0 ? (
                <div className="text-xs text-gray-500">Fill qty and cost to see GL preview.</div>
              ) : (
                glPreview.map((l, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between text-xs px-3 py-2 rounded-lg bg-black/20 border border-white/10"
                  >
                    <div className="text-gray-200">
                      {l.dr ? <span>Dr <span className="text-white font-semibold">{l.dr}</span></span> : null}
                      {l.dr && l.cr ? <span className="text-gray-500"> / </span> : null}
                      {l.cr ? <span>Cr <span className="text-white font-semibold">{l.cr}</span></span> : null}
                    </div>
                    <div className="text-white font-mono">{formatCurrency(l.amount)}</div>
                  </div>
                ))
              )}
            </div>

            <p className="text-[10px] text-gray-500 mt-3">
              Posting happens when finance runs “Post Approved” or rebuilds the GL for the period.
            </p>
          </Card>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button icon={PackagePlus} onClick={handleSave} disabled={saving || !canSave}>
              {saving ? 'Saving...' : 'Save Stock-In'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}