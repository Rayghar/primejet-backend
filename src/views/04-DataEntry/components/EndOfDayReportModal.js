// src/views/Finance/EndOfDayReportModal.js
import React, { useEffect, useMemo, useState } from 'react';
import Modal from '../../../components/shared/Modal';
import Button from '../../../components/shared/Button';
import Card from '../../../components/shared/Card';
import { getDailySummaryReport } from '../../../api/dataEntryService';
import { glPostApproved, glRetryFailed, glTrialBalance } from '../../../api/glService';
import { formatCurrency } from '../../../utils/formatters';
import { Printer, RefreshCw, BookOpen, Hammer, CheckCircle2, AlertTriangle } from 'lucide-react';

const safeNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const fmtDate = (d) => {
  const x = d ? new Date(d) : null;
  if (!x || Number.isNaN(x.getTime())) return '—';
  return x.toISOString().slice(0, 10);
};

export default function EndOfDayReportModal({ isOpen, onClose, summaryId, businessDate, branchId }) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [tb, setTb] = useState(null);

  const load = async () => {
    if (!summaryId) return;
    setLoading(true);
    setErr('');
    setInfo('');
    try {
      const r = await getDailySummaryReport(summaryId);
      setReport(r);
    } catch (e) {
      setErr(e?.message || 'Failed to load report.');
      setReport(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, summaryId]);

  const totals = useMemo(() => {
    const s = report?.summary || report?.dailySummary || report?.data || report || {};
    return {
      revenue: safeNum(s?.sales?.totalRevenue),
      kg: safeNum(s?.sales?.totalKgSold),
      cash: safeNum(s?.sales?.cashAmount),
      transfer: safeNum(s?.sales?.transferAmount),
      pos: safeNum(s?.sales?.posAmount),
      expenses: safeNum(s?.expenses?.total),
      discrepancy: safeNum(s?.reconciliation?.discrepancy),
      date: s?.date,
    };
  }, [report]);

  const doPostToGL = async () => {
    setErr('');
    setInfo('');
    try {
      const date = businessDate || fmtDate(totals.date);
      if (!date) throw new Error('businessDate is required');
      const r = await glPostApproved({ businessDate: date, branchIdOrZoneId: branchId });
      setInfo(`Posted to GL: ${JSON.stringify(r?.posted || {})}`);
    } catch (e) {
      setErr(e?.message || 'Post to GL failed');
    }
  };

  const doRetryFailed = async () => {
    setErr('');
    setInfo('');
    try {
      const date = businessDate || fmtDate(totals.date);
      if (!date) throw new Error('businessDate is required');
      const r = await glRetryFailed({ startDate: date, endDate: date, branchIdOrZoneId: branchId });
      setInfo(`Retry complete: ${JSON.stringify(r?.failed || {})}`);
    } catch (e) {
      setErr(e?.message || 'Retry failed');
    }
  };

  const doTrialBalance = async () => {
    setErr('');
    setInfo('');
    try {
      const date = businessDate || fmtDate(totals.date);
      if (!date) throw new Error('businessDate is required');
      const r = await glTrialBalance({ startDate: date, endDate: date, branchIdOrZoneId: branchId });
      setTb(r);
      setInfo(`Trial balance: ${r?.totals?.balanced ? 'BALANCED' : 'NOT BALANCED'}`);
    } catch (e) {
      setErr(e?.message || 'Trial balance failed');
    }
  };

  const print = () => window.print();

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="End of Day Report (GL-first)">
      <div className="space-y-4">
        <div className="flex gap-2 justify-end print:hidden">
          <Button variant="secondary" icon={RefreshCw} onClick={load}>
            Refresh
          </Button>
          <Button variant="secondary" icon={Printer} onClick={print}>
            Print
          </Button>
        </div>

        {(err || info) && (
          <Card className="bg-white/5 border border-white/10 p-3 rounded-xl">
            {err ? <div className="text-xs text-red-300">{err}</div> : null}
            {info ? <div className="text-xs text-emerald-300">{info}</div> : null}
          </Card>
        )}

        <Card className="bg-white/5 border border-white/10 p-4 rounded-xl">
          {loading ? (
            <div className="text-center text-blue-400 animate-pulse">Loading…</div>
          ) : !report ? (
            <div className="text-center text-gray-500">No report data.</div>
          ) : (
            <div className="space-y-3">
              <div className="text-sm font-bold text-white">Summary</div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="p-3 rounded-xl bg-black/20 border border-white/10">
                  <div className="text-[11px] text-gray-400">Revenue</div>
                  <div className="text-xl font-bold text-white">{formatCurrency(totals.revenue)}</div>
                  <div className="text-[10px] text-gray-500 mt-1">Business date: {fmtDate(totals.date)}</div>
                </div>
                <div className="p-3 rounded-xl bg-black/20 border border-white/10">
                  <div className="text-[11px] text-gray-400">Kg Sold</div>
                  <div className="text-xl font-bold text-white">{totals.kg.toLocaleString()} kg</div>
                  <div className="text-[10px] text-gray-500 mt-1">COGS posted via WAC (backend)</div>
                </div>
                <div className="p-3 rounded-xl bg-black/20 border border-white/10">
                  <div className="text-[11px] text-gray-400">Discrepancy</div>
                  <div className="text-xl font-bold text-white">{totals.discrepancy.toLocaleString()}</div>
                  <div className="text-[10px] text-gray-500 mt-1">DailySummary.reconciliation.discrepancy</div>
                </div>
              </div>

              <div className="text-xs text-gray-400 mt-2">POS split:</div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="p-3 rounded-xl bg-black/20 border border-white/10">
                  <div className="text-[11px] text-gray-400">Cash</div>
                  <div className="text-lg font-bold text-white">{formatCurrency(totals.cash)}</div>
                </div>
                <div className="p-3 rounded-xl bg-black/20 border border-white/10">
                  <div className="text-[11px] text-gray-400">Transfer</div>
                  <div className="text-lg font-bold text-white">{formatCurrency(totals.transfer)}</div>
                </div>
                <div className="p-3 rounded-xl bg-black/20 border border-white/10">
                  <div className="text-[11px] text-gray-400">POS</div>
                  <div className="text-lg font-bold text-white">{formatCurrency(totals.pos)}</div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2 print:hidden">
                <Button icon={BookOpen} onClick={doPostToGL}>
                  Post to GL
                </Button>
                <Button icon={Hammer} variant="secondary" onClick={doRetryFailed}>
                  Retry failed
                </Button>
                <Button icon={CheckCircle2} variant="secondary" onClick={doTrialBalance}>
                  Trial Balance
                </Button>
              </div>

              {tb ? (
                <div className="mt-3 p-3 rounded-xl bg-black/20 border border-white/10">
                  <div className="flex items-center gap-2 text-sm font-semibold text-white">
                    {tb?.totals?.balanced ? (
                      <CheckCircle2 size={16} className="text-emerald-300" />
                    ) : (
                      <AlertTriangle size={16} className="text-amber-300" />
                    )}
                    Trial Balance Result
                  </div>
                  <div className="mt-2 text-xs text-gray-300">
                    Debit: <span className="font-mono">{safeNum(tb?.totals?.debit).toLocaleString()}</span> • Credit:{' '}
                    <span className="font-mono">{safeNum(tb?.totals?.credit).toLocaleString()}</span> • Diff:{' '}
                    <span className="font-mono">{safeNum(tb?.totals?.diff).toLocaleString()}</span>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </Card>
      </div>
    </Modal>
  );
}