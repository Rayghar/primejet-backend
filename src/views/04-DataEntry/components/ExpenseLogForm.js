// src/components/forms/ExpenseLogForm.js
import React, { useMemo, useState } from 'react';
import Button from '../../../components/shared/Button';
import Card from '../../../components/shared/Card';
import { logExpense } from '../../../api/dataEntryService';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

const safeNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const hasVal = (v) => v !== undefined && v !== null && String(v).trim() !== '';

const CATEGORY_TO_ACCOUNT = {
  STAFF: { code: '6000', name: 'Staff Costs' },
  LOGISTICS: { code: '6100', name: 'Logistics & Fuel' },
  UTILITIES: { code: '6200', name: 'Utilities' },
  MAINTENANCE: { code: '6300', name: 'Maintenance' },
  MARKETING: { code: '6400', name: 'Marketing' },
  ADMIN: { code: '6500', name: 'Admin & General' },
};

const DISPOSITION_TO_CREDIT = {
  CASH: { code: '1000', name: 'Cash on Hand' },
  TRANSFER: { code: '1010', name: 'Bank - Transfers' },
  POS: { code: '1020', name: 'Bank - POS Settlements' },
  UNPAID: { code: '2000', name: 'Accounts Payable' },
};

export default function ExpenseLogForm({ summaryId, branchId, businessDate, onSaved }) {
  const [category, setCategory] = useState('ADMIN');
  const [paymentDisposition, setPaymentDisposition] = useState('CASH');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const amt = useMemo(() => safeNum(amount), [amount]);

  const debitAcct = CATEGORY_TO_ACCOUNT[category] || CATEGORY_TO_ACCOUNT.ADMIN;
  const creditAcct = DISPOSITION_TO_CREDIT[paymentDisposition] || DISPOSITION_TO_CREDIT.CASH;

  const canSubmit = useMemo(() => {
    return hasVal(summaryId) && hasVal(branchId) && hasVal(businessDate) && amt > 0 && hasVal(description);
  }, [summaryId, branchId, businessDate, amt, description]);

  const submit = async () => {
    setErr('');
    setMsg('');

    if (!canSubmit) {
      setErr('Business Date, Branch, Description, and Amount are required.');
      return;
    }

    setLoading(true);
    try {
      const payload = {
        dailySummaryId: summaryId,
        branchId,
        date: businessDate, // business date
        amount: amt,
        description,
        category, // explicit mapping input
        paymentDisposition, // drives credit leg
      };

      const r = await logExpense(payload);
      setMsg('Expense captured.');
      setAmount('');
      setDescription('');
      onSaved?.(r);
    } catch (e) {
      setErr(e?.message || 'Failed to log expense.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="bg-white/5 border border-white/10 p-4 rounded-xl">
      <div className="text-sm font-bold text-white">GL-native Expense Entry</div>
      <div className="text-xs text-gray-400 mt-1">
        This entry will be posted to GL on approval/posting (or rebuild). Business date is mandatory.
      </div>

      {(err || msg) && (
        <div className="mt-3">
          {err ? <div className="text-xs text-red-300">{err}</div> : null}
          {msg ? <div className="text-xs text-emerald-300">{msg}</div> : null}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
        <div>
          <label className="text-xs text-gray-400 block mb-1">Category (maps to COA)</label>
          <select
            className="w-full px-3 py-2 rounded-lg bg-black/30 text-white border border-white/10"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {Object.keys(CATEGORY_TO_ACCOUNT).map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <div className="text-[10px] text-gray-500 mt-1">
            Dr {debitAcct.code} ({debitAcct.name})
          </div>
        </div>

        <div>
          <label className="text-xs text-gray-400 block mb-1">Payment disposition</label>
          <select
            className="w-full px-3 py-2 rounded-lg bg-black/30 text-white border border-white/10"
            value={paymentDisposition}
            onChange={(e) => setPaymentDisposition(e.target.value)}
          >
            {Object.keys(DISPOSITION_TO_CREDIT).map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <div className="text-[10px] text-gray-500 mt-1">
            Cr {creditAcct.code} ({creditAcct.name})
          </div>
        </div>

        <div className="md:col-span-2">
          <label className="text-xs text-gray-400 block mb-1">Description</label>
          <input
            className="w-full px-3 py-2 rounded-lg bg-black/30 text-white border border-white/10"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g., Ground compacting"
          />
        </div>

        <div>
          <label className="text-xs text-gray-400 block mb-1">Amount (₦)</label>
          <input
            type="number"
            className="w-full px-3 py-2 rounded-lg bg-black/30 text-white border border-white/10"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            min="0"
          />
        </div>

        <div className="flex items-end">
          <Button onClick={submit} disabled={!canSubmit || loading}>
            {loading ? 'Saving…' : 'Add expense'}
          </Button>
        </div>
      </div>

      {/* GL preview */}
      <div className="mt-4 p-3 rounded-xl bg-black/20 border border-white/10">
        <div className="text-xs text-gray-300 font-semibold flex items-center gap-2">
          <CheckCircle2 size={14} className="text-emerald-300" /> GL Preview (what will be posted)
        </div>
        <div className="mt-2 text-[11px] text-gray-300">
          <div>
            Dr <span className="font-mono">{debitAcct.code}</span> — {debitAcct.name}:{' '}
            <span className="font-mono">₦{amt.toLocaleString()}</span>
          </div>
          <div>
            Cr <span className="font-mono">{creditAcct.code}</span> — {creditAcct.name}:{' '}
            <span className="font-mono">₦{amt.toLocaleString()}</span>
          </div>
          {!hasVal(businessDate) || !hasVal(branchId) ? (
            <div className="mt-2 text-amber-300 flex items-center gap-2">
              <AlertTriangle size={14} /> Business Date + Branch must be set in workspace.
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}