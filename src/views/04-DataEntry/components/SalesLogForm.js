// src/components/forms/SalesLogForm.js
import React, { useMemo, useState } from 'react';
import Button from '../../../components/shared/Button';
import Card from '../../../components/shared/Card';
import { logSale } from '../../../api/dataEntryService';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

const safeNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const hasVal = (v) => v !== undefined && v !== null && String(v).trim() !== '';

export default function SalesLogForm({ summaryId, branchId, businessDate, onSaved }) {
  const [productName, setProductName] = useState('LPG Gas');
  const [quantityKg, setQuantityKg] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('CASH'); // CASH|TRANSFER|POS

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const qty = useMemo(() => safeNum(quantityKg), [quantityKg]);
  const price = useMemo(() => safeNum(unitPrice), [unitPrice]);
  const amount = useMemo(() => (qty > 0 && price > 0 ? qty * price : 0), [qty, price]);

  const canSubmit = useMemo(() => {
    return hasVal(summaryId) && hasVal(branchId) && hasVal(businessDate) && qty > 0 && price > 0;
  }, [summaryId, branchId, businessDate, qty, price]);

  const submit = async () => {
    setErr('');
    setMsg('');

    if (!canSubmit) {
      setErr('Business Date, Branch, Quantity, and Unit Price are required.');
      return;
    }

    setLoading(true);
    try {
      const payload = {
        dailySummaryId: summaryId,
        branchId,
        date: businessDate, // business date
        productName,
        quantity: qty,
        unitPrice: price,
        amount,
        paymentMethod, // used later by backend if needed
      };

      const r = await logSale(payload);
      setMsg('Sale line captured.');
      setQuantityKg('');
      setUnitPrice('');
      onSaved?.(r);
    } catch (e) {
      setErr(e?.message || 'Failed to log sale.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="bg-white/5 border border-white/10 p-4 rounded-xl">
      <div className="text-sm font-bold text-white">Sales Line (optional but recommended)</div>
      <div className="text-xs text-gray-400 mt-1">
        For migrated days you may have totals only. For new days, capture sales lines to strengthen auditability.
      </div>

      {(err || msg) && (
        <div className="mt-3">
          {err ? <div className="text-xs text-red-300">{err}</div> : null}
          {msg ? <div className="text-xs text-emerald-300">{msg}</div> : null}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
        <div>
          <label className="text-xs text-gray-400 block mb-1">Product</label>
          <input
            className="w-full px-3 py-2 rounded-lg bg-black/30 text-white border border-white/10"
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
          />
        </div>

        <div>
          <label className="text-xs text-gray-400 block mb-1">Payment Method</label>
          <select
            className="w-full px-3 py-2 rounded-lg bg-black/30 text-white border border-white/10"
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
          >
            <option value="CASH">CASH</option>
            <option value="TRANSFER">TRANSFER</option>
            <option value="POS">POS</option>
          </select>
        </div>

        <div>
          <label className="text-xs text-gray-400 block mb-1">Quantity (kg)</label>
          <input
            type="number"
            className="w-full px-3 py-2 rounded-lg bg-black/30 text-white border border-white/10"
            value={quantityKg}
            onChange={(e) => setQuantityKg(e.target.value)}
            min="0"
          />
        </div>

        <div>
          <label className="text-xs text-gray-400 block mb-1">Unit Price (₦/kg)</label>
          <input
            type="number"
            className="w-full px-3 py-2 rounded-lg bg-black/30 text-white border border-white/10"
            value={unitPrice}
            onChange={(e) => setUnitPrice(e.target.value)}
            min="0"
          />
        </div>

        <div className="md:col-span-2 flex items-end justify-between">
          <div className="text-[11px] text-gray-300 flex items-center gap-2">
            <CheckCircle2 size={14} className="text-emerald-300" />
            Amount: <span className="font-mono">₦{amount.toLocaleString()}</span>
            {!hasVal(businessDate) || !hasVal(branchId) ? (
              <span className="text-amber-300 flex items-center gap-1 ml-3">
                <AlertTriangle size={14} />
                Set Business Date + Branch in workspace
              </span>
            ) : null}
          </div>

          <Button onClick={submit} disabled={!canSubmit || loading}>
            {loading ? 'Saving…' : 'Add sale line'}
          </Button>
        </div>
      </div>
    </Card>
  );
}