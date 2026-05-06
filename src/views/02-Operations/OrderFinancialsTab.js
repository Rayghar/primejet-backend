// File: src/views/02-Operations/OrderFinancialTab.js
import React, { useMemo } from 'react';
import Card from '../../components/shared/Card';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { CheckCircle2, AlertTriangle } from 'lucide-react';

const safeNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const statusTone = (s) => {
  const x = String(s || '').toUpperCase();
  if (x === 'POSTED') return 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20';
  if (x === 'FAILED') return 'text-red-300 bg-red-500/10 border-red-500/20';
  if (x === 'QUEUED') return 'text-blue-300 bg-blue-500/10 border-blue-500/20';
  return 'text-gray-300 bg-white/5 border-white/10';
};

export default function OrderFinancialTab({ order }) {
  const businessDate = useMemo(() => order?.orderDate || order?.createdAt || null, [order]);
  const posting = order?.posting || {};
  const postingStatus = posting?.status || 'UNPOSTED';

  // If your backend returns GL refs on order.posting.glEntryIds
  const glRefs = Array.isArray(posting?.glEntryIds) ? posting.glEntryIds : posting?.glEntryId ? [posting.glEntryId] : [];

  const amount = safeNum(order?.grandTotal ?? order?.totalAmount, 0);

  return (
    <div className="space-y-4">
      <Card className="bg-white/5 border border-white/10 rounded-xl p-4">
        <div className="text-sm font-semibold text-white mb-2">Financial Posting</div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="p-3 rounded-xl bg-black/20 border border-white/10">
            <div className="text-[11px] text-gray-400">Business Date</div>
            <div className="text-white font-semibold">{businessDate ? formatDate(businessDate) : '—'}</div>
            <div className="text-[10px] text-gray-500 mt-1">orderDate fallback createdAt</div>
          </div>

          <div className="p-3 rounded-xl bg-black/20 border border-white/10">
            <div className="text-[11px] text-gray-400">Amount</div>
            <div className="text-white font-semibold">{formatCurrency(amount)}</div>
          </div>

          <div className="p-3 rounded-xl border flex items-center justify-between ${statusTone(postingStatus)}">
            <div>
              <div className="text-[11px] text-gray-400">Posting Status</div>
              <div className="text-white font-semibold">{String(postingStatus).toUpperCase()}</div>
            </div>
            {String(postingStatus).toUpperCase() === 'POSTED' ? (
              <CheckCircle2 size={18} className="text-emerald-300" />
            ) : String(postingStatus).toUpperCase() === 'FAILED' ? (
              <AlertTriangle size={18} className="text-red-300" />
            ) : null}
          </div>
        </div>

        {postingStatus === 'FAILED' ? (
          <div className="mt-3 text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl p-3">
            {posting?.errorCode || 'FAILED'} — {posting?.errorMessage || 'Posting failed.'}
          </div>
        ) : null}

        <div className="mt-3">
          <div className="text-[11px] text-gray-400 mb-1">GL References</div>
          {glRefs.length ? (
            <ul className="text-xs text-gray-200 list-disc pl-5 space-y-1">
              {glRefs.map((id) => (
                <li key={String(id)} className="font-mono">
                  {String(id)}
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-xs text-gray-500">No GL entry references yet.</div>
          )}
        </div>

        <div className="mt-3 text-[10px] text-gray-500">
          If you support “Delivered unpaid then later paid”, you’ll add a second receipt posting:
          Dr Cash/Bank, Cr Accounts Receivable.
        </div>
      </Card>
    </div>
  );
}