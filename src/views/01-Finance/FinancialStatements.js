import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileText, Printer, RefreshCw, ShieldCheck, RotateCcw } from 'lucide-react';
import { getFinancialStatements } from '../../api/financialService';
import { glPostingExceptions, glTrialBalance } from '../../api/glService';
import { getPlants } from '../../api/operationsService';
import { getBranchOptions } from '../../api/userService';
import { useAuth } from '../../hooks/useAuth';
import { normalizeBranchOptions, filterBranchesForUser, chooseDefaultBranch, getBranchValue, getBranchLabel, branchAccessMessage, isUserBranchRestricted } from '../../utils/branchAccess';
import PageTitle from '../../components/shared/PageTitle';
import Button from '../../components/shared/Button';
import HelpPanel from '../../components/shared/HelpPanel';
import HelpTooltip from '../../components/shared/HelpTooltip';
import { GL_HELP, PLANT_OPS_HELP } from '../../utils/helpCatalog';
import { formatCurrency } from '../../utils/formatters';

const safeNumber = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const fmtDate = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 10);
};
const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
const migrationStart = () => '2025-06-01';

const sourceLabels = {
  auto: 'Auto: GL when usable, operational fallback when GL has no statement activity',
  gl: 'GL only: audit-grade posted journals only',
  operational: 'Operational: POS, orders, expenses and stock records',
};

function Field({ label, children, hint }) {
  return (
    <label className="text-xs text-slate-300 space-y-1">
      <span className="block">{label}</span>
      {children}
      {hint && <span className="block text-[10px] text-slate-500">{hint}</span>}
    </label>
  );
}

function StatementRow({ label, value, pct, indent = false, bold = false, total = false, negative = false }) {
  const rowClass = total ? 'bg-slate-100 border-t border-slate-400' : bold ? 'bg-slate-50' : '';
  const display = negative ? `(${formatCurrency(Math.abs(safeNumber(value)))})` : formatCurrency(value);
  return (
    <tr className={rowClass}>
      <td className={`py-2.5 pr-4 ${indent ? 'pl-6 text-slate-600' : 'text-slate-900'} ${bold || total ? 'font-bold' : 'font-medium'}`}>{label}</td>
      <td className={`py-2.5 text-right font-mono ${negative ? 'text-red-700' : safeNumber(value) < 0 ? 'text-red-700' : 'text-slate-900'} ${bold || total ? 'font-bold' : ''}`}>{display}</td>
      {pct !== undefined && <td className="py-2.5 text-right text-slate-500 font-mono">{pct}</td>}
    </tr>
  );
}

function BalanceSection({ title, rows = [] }) {
  const total = rows.reduce((sum, r) => sum + safeNumber(r.value), 0);
  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
      <div className="px-4 py-3 bg-slate-100 border-b border-slate-200 font-bold text-slate-900">{title}</div>
      {rows.length === 0 ? (
        <div className="px-4 py-3 text-sm text-slate-500">No rows available.</div>
      ) : (
        rows.map((r, idx) => (
          <div key={`${title}-${idx}`} className="flex justify-between gap-4 px-4 py-2.5 border-b border-slate-100 last:border-b-0 text-sm">
            <span className="text-slate-700">{r.name}</span>
            <span className="font-mono font-semibold text-slate-900">{formatCurrency(safeNumber(r.value))}</span>
          </div>
        ))
      )}
      <div className="flex justify-between gap-4 px-4 py-3 bg-slate-50 border-t border-slate-200 text-sm font-bold">
        <span>Total {title}</span>
        <span className="font-mono">{formatCurrency(total)}</span>
      </div>
    </div>
  );
}

export default function FinancialStatements({ setActiveView }) {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('income');
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState('');
  const [period, setPeriod] = useState('monthly');
  const [sourceMode, setSourceMode] = useState('auto');
  const [customStart, setCustomStart] = useState(migrationStart());
  const [customEnd, setCustomEnd] = useState(today());
  const [data, setData] = useState(null);
  const [trialBalance, setTrialBalance] = useState(null);
  const [exceptions, setExceptions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const startDate = period === 'custom' ? customStart : undefined;
  const endDate = period === 'custom' ? customEnd : undefined;

  const fetchBranches = async () => {
    try {
      let options = await getBranchOptions();
      if (!Array.isArray(options) || options.length === 0) {
        const plants = await getPlants();
        options = Array.isArray(plants) ? plants : [];
      }
      const normalized = normalizeBranchOptions(options);
      const scoped = filterBranchesForUser(normalized, user || {});
      setBranches(scoped.map((branch) => ({
        ...branch,
        id: getBranchValue(branch),
        name: getBranchLabel(branch),
      })));

      if (isUserBranchRestricted(user || {})) {
        const defaultBranch = chooseDefaultBranch(normalized, user || {});
        const defaultValue = defaultBranch ? getBranchValue(defaultBranch) : '';
        setBranchId((current) => {
          if (current && scoped.some((branch) => getBranchValue(branch) === current)) return current;
          return defaultValue || current;
        });
      }
    } catch (e) {
      console.error('Failed to load branches:', e);
      setBranches([]);
    }
  };

  const fetchStatements = async () => {
    if (period === 'custom' && (!customStart || !customEnd)) {
      setErrorMsg('Select both custom start and end dates.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await getFinancialStatements({ period, startDate, endDate, branchIdOrZoneId: branchId || undefined, sourceMode });
      setData(res || null);
      if (res?.period?.start && res?.period?.end) {
        const s = fmtDate(res.period.start);
        const e = fmtDate(res.period.end);
        const [tb, ex] = await Promise.allSettled([
          glTrialBalance({ startDate: s, endDate: e, branchIdOrZoneId: branchId || undefined }),
          glPostingExceptions({ startDate: s, endDate: e, branchIdOrZoneId: branchId || undefined }),
        ]);
        setTrialBalance(tb.status === 'fulfilled' ? tb.value : null);
        setExceptions(ex.status === 'fulfilled' ? ex.value : null);
      } else {
        setTrialBalance(null);
        setExceptions(null);
      }
    } catch (err) {
      console.error(err);
      setData(null);
      setTrialBalance(null);
      setExceptions(null);
      setErrorMsg(err?.response?.data?.message || err?.message || 'Failed to load financial statements.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchBranches(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user?.id, user?.branchScope, JSON.stringify(user?.allowedBranches || [])]);
  useEffect(() => { fetchStatements(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [period, customStart, customEnd, branchId, sourceMode]);

  const periodLabel = useMemo(() => {
    if (period === 'custom') return `${customStart || '—'} → ${customEnd || '—'}`;
    if (period === 'monthly') return 'This Month';
    if (period === 'quarterly') return 'This Quarter';
    if (period === 'yearly') return 'This Year';
    if (period === 'allTime') return 'All Migrated Data';
    return period;
  }, [period, customStart, customEnd]);

  const backendPeriodLabel = useMemo(() => data?.period ? `${fmtDate(data.period.start)} → ${fmtDate(data.period.end)}` : null, [data]);
  const scopeMessage = branchAccessMessage(branches, user || {});
  const restrictedUser = isUserBranchRestricted(user || {});
  const selectedBranchName = branches.find((b) => String(b.id) === String(branchId))?.name || (branchId ? branchId : (restrictedUser ? 'All Assigned Branches' : 'All Branches')); 

  const revenueTotal = safeNumber(data?.income?.revenue?.total);
  const cogsTotal = safeNumber(data?.income?.cogs?.total);
  const grossProfit = safeNumber(data?.income?.grossProfit);
  const ebitda = safeNumber(data?.income?.ebitda);
  const depreciation = safeNumber(data?.income?.depreciation);
  const interest = safeNumber(data?.income?.interest);
  const tax = safeNumber(data?.income?.tax);
  const netIncome = safeNumber(data?.income?.netIncome);
  const deliveryRecognized = safeNumber(data?.income?.revenue?.delivery);
  const deliveryInvoiced = safeNumber(data?.income?.revenue?.deliveryInvoiced);
  const deliveryUnpaidDelivered = safeNumber(data?.income?.revenue?.deliveryUnpaidDelivered);
  const posRevenue = safeNumber(data?.income?.revenue?.pos);
  const otherRevenue = safeNumber(data?.income?.revenue?.other);
  const expenses = data?.income?.expenses || {};
  const expenseRows = [
    ['Staff Costs', safeNumber(expenses.salaries)],
    ['Logistics & Fuel', safeNumber(expenses.logistics)],
    ['Utilities', safeNumber(expenses.utilities)],
    ['Maintenance', safeNumber(expenses.maintenance)],
    ['Marketing', safeNumber(expenses.marketing)],
    ['Admin & General', safeNumber(expenses.admin)],
  ];
  const totalOpex = safeNumber(expenses.total);
  const getPercentage = (val, total = revenueTotal) => total > 0 ? `${((safeNumber(val) / total) * 100).toFixed(1)}%` : '0.0%';
  const tbBalanced = Boolean(trialBalance?.totals?.balanced);
  const failedPostingCount = safeNumber(exceptions?.totals?.failed);
  const hasAnyStatementValue = Math.abs(revenueTotal) + Math.abs(cogsTotal) + Math.abs(totalOpex) + Math.abs(netIncome) > 0;
  const sourceUsed = data?.gl?.sourceMode || (data?.gl?.enabled ? 'gl' : 'operational');
  const glCompleteness = data?.gl?.completeness || null;
  const glSourceNote = data?.gl?.warning || data?.gl?.fallbackReason || data?.reportingPolicy?.fallbackReason || null;
  const reportingPolicy = data?.reportingPolicy || null;
  const cautions = Array.isArray(data?.balance?.cautions) ? data.balance.cautions : [];
  const cashFlow = data?.cashFlow || {};
  const ratios = data?.ratios || {};

  if (loading) return <div className="p-10 text-center text-blue-400 animate-pulse">Loading financial statements...</div>;

  if (!data) {
    return (
      <div className="p-10 text-center text-slate-400">
        <p>{errorMsg || 'No data available.'}</p>
        <div className="mt-4"><Button icon={RefreshCw} onClick={fetchStatements}>Retry</Button></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-3 print:hidden">
        <PageTitle title="Financial Statements" subtitle="Management accounts with GL audit mode and operational fallback" />
        <div className="flex gap-2">
          {setActiveView && <Button variant="secondary" icon={RotateCcw} onClick={() => setActiveView('GLReversalWorkbench')}>Reverse GL Entries</Button>}
          <Button variant="secondary" icon={RefreshCw} onClick={fetchStatements}>Refresh</Button>
          <Button variant="secondary" icon={Printer} onClick={() => window.print()}>Export PDF</Button>
        </div>
      </div>

      <HelpPanel
        title="Management Accounts guide"
        items={[
          { key: 'trialBalance', label: 'Trial Balance', help: GL_HELP.trialBalance },
          { key: 'periodLock', label: 'Period Lock', help: GL_HELP.periodLock },
          { key: 'reversal', label: 'GL Reversal', help: 'Open Finance & ERP → GL Reversals, filter the period/branch, request reversal on the journal, then approve it using a different finance/admin user.' },
          { key: 'branchProfitability', label: 'Branch Profitability', help: PLANT_OPS_HELP.branchProfitability },
        ]}
      />

      <div className="bg-slate-900/70 border border-white/10 rounded-2xl p-4 print:hidden space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-white font-semibold">
            <ShieldCheck size={18} className="text-emerald-300" />
            Statement source: <span className="text-emerald-300">{sourceUsed === 'gl' ? 'GL audit mode' : 'Operational management mode'}</span>
            <HelpTooltip text={sourceLabels[sourceMode]} />
          </div>
          <div className="flex flex-wrap gap-3 text-xs">
            {trialBalance ? <span className={tbBalanced ? 'text-emerald-300' : 'text-amber-300'}>{tbBalanced ? '✓ Trial Balance Balanced' : '⚠ Trial Balance NOT Balanced'}</span> : <span className="text-slate-500">Trial Balance: N/A</span>}
            {exceptions ? <span className={failedPostingCount > 0 ? 'text-amber-300' : 'text-emerald-300'}>Posting failures: {failedPostingCount}</span> : <span className="text-slate-500">Posting failures: N/A</span>}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <Field label="Branch">
            <select className="w-full px-3 py-2 rounded-xl bg-slate-950 text-white border border-white/10" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">{restrictedUser ? 'All Assigned Branches' : 'All Branches'}</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
          <Field label="Period">
            <select className="w-full px-3 py-2 rounded-xl bg-slate-950 text-white border border-white/10" value={period} onChange={(e) => setPeriod(e.target.value)}>
              <option value="monthly">This Month</option>
              <option value="quarterly">This Quarter</option>
              <option value="yearly">This Year</option>
              <option value="allTime">All Migrated Data</option>
              <option value="custom">Custom Range</option>
            </select>
          </Field>
          <Field label="Start Date" hint={period !== 'custom' ? 'Enabled for Custom Range' : 'Set to 2025-06-01 to validate full migrated data'}>
            <input type="date" disabled={period !== 'custom'} className="w-full px-3 py-2 rounded-xl bg-slate-950 text-white border border-white/10 disabled:opacity-50" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
          </Field>
          <Field label="End Date" hint={period !== 'custom' ? 'Enabled for Custom Range' : ''}>
            <input type="date" disabled={period !== 'custom'} className="w-full px-3 py-2 rounded-xl bg-slate-950 text-white border border-white/10 disabled:opacity-50" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
          </Field>
          <Field label="Source Mode">
            <select className="w-full px-3 py-2 rounded-xl bg-slate-950 text-white border border-white/10" value={sourceMode} onChange={(e) => setSourceMode(e.target.value)}>
              <option value="auto">Auto</option>
              <option value="gl">GL only</option>
              <option value="operational">Operational</option>
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
          <div className="rounded-xl bg-slate-950/60 border border-white/10 p-3"><span className="text-slate-400">UI Period</span><div className="text-white font-semibold">{periodLabel}</div></div>
          <div className="rounded-xl bg-slate-950/60 border border-white/10 p-3"><span className="text-slate-400">Backend Range</span><div className="text-white font-semibold">{backendPeriodLabel || '—'}</div></div>
          <div className="rounded-xl bg-slate-950/60 border border-white/10 p-3"><span className="text-slate-400">Branch</span><div className="text-white font-semibold">{selectedBranchName}</div></div>
          <div className="rounded-xl bg-slate-950/60 border border-white/10 p-3"><span className="text-slate-400">OPEX Source</span><div className="text-white font-semibold">{expenses.source || 'N/A'}</div></div>
        </div>

        {reportingPolicy && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-100">
            <b>Date/source basis:</b> {reportingPolicy.dateRange?.basis || 'business_date'} · {reportingPolicy.sourceOfTruth?.auto || 'Auto mode uses GL only when complete.'}
          </div>
        )}

        {period === 'yearly' && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
            <b>This Year</b> is calendar-year-to-date only. For your migration validation, use <b>All Migrated Data</b> or <b>Custom Range</b> from 2025-06-01 to today.
          </div>
        )}

        {restrictedUser && (
          <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-3 text-sm text-blue-100">
            <b>Investor branch scope active:</b> this page is restricted to {selectedBranchName}. {scopeMessage ? <span>{scopeMessage}</span> : null}
          </div>
        )}

        {glSourceNote && (
          <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-3 text-sm text-blue-100">
            <b>Statement source note:</b> {glSourceNote}
            {glCompleteness ? (
              <span className="block mt-1 text-xs text-blue-200">
                Posting backlog in selected range — Daily summaries: {glCompleteness.dailySummaries || 0}, Expenses: {glCompleteness.expenses || 0}, Stock-in: {glCompleteness.stockIns || 0}, Failed journals: {glCompleteness.failedJournals || 0}.
              </span>
            ) : null}
          </div>
        )}

        {!hasAnyStatementValue && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
            No revenue, COGS or OPEX values were found for this source/period. Try <b>Operational</b> mode, widen the period, or confirm that approved sales/expenses have been posted to GL.
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-1 bg-white/5 p-1 rounded-xl w-fit print:hidden">
        {[
          ['income', 'P&L'],
          ['balance', 'Balance Sheet'],
          ['cashflow', 'Cash Flow'],
          ['ratios', 'Ratios'],
          ['notes', 'Notes'],
        ].map(([id, label]) => (
          <button key={id} onClick={() => setActiveTab(id)} className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${activeTab === id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>{label}</button>
        ))}
      </div>

      <div className="max-w-6xl mx-auto rounded-2xl shadow-2xl overflow-hidden border border-slate-200" style={{ background: '#ffffff', color: '#111827', backdropFilter: 'none' }}>
        <div className="px-10 py-8 border-b border-slate-200 bg-white">
          <div className="flex flex-wrap justify-between gap-4 items-start">
            <div>
              <h1 className="text-2xl font-black tracking-[0.25em] uppercase text-slate-950">PrimeJet Gas Ltd</h1>
              <h2 className="text-base font-bold text-slate-600 uppercase mt-2">
                {activeTab === 'income' ? 'Statement of Comprehensive Income' : activeTab === 'balance' ? 'Statement of Financial Position' : activeTab === 'cashflow' ? 'Cash Flow Statement' : activeTab === 'ratios' ? 'Financial Ratios & Covenants' : 'Statement Notes'}
              </h2>
            </div>
            <div className="text-right text-xs text-slate-600">
              <div><b>Period:</b> {periodLabel}</div>
              <div><b>Backend range:</b> {backendPeriodLabel}</div>
              <div><b>Branch:</b> {selectedBranchName}</div>
              <div><b>Source:</b> {sourceUsed}</div>
            </div>
          </div>
        </div>

        <div className="p-10 bg-white">
          {activeTab === 'income' && (
            <table className="w-full text-sm border-collapse">
              <thead className="border-b-2 border-slate-900 text-slate-900">
                <tr><th className="text-left py-3">Item</th><th className="text-right py-3">Amount</th><th className="text-right py-3">% Revenue</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                <StatementRow label="REVENUE" value={revenueTotal} pct="100.0%" bold />
                <StatementRow label="Delivery Revenue" value={deliveryRecognized} pct={getPercentage(deliveryRecognized)} indent />
                <StatementRow label="POS Revenue" value={posRevenue} pct={getPercentage(posRevenue)} indent />
                <StatementRow label="Other Revenue" value={otherRevenue} pct={getPercentage(otherRevenue)} indent />
                <StatementRow label="Cost of Sales (LPG)" value={cogsTotal} pct={getPercentage(cogsTotal)} indent negative />
                <StatementRow label="GROSS PROFIT" value={grossProfit} pct={getPercentage(grossProfit)} total />
                <StatementRow label="Operating Expenses" value={totalOpex} pct={getPercentage(totalOpex)} bold negative />
                {expenseRows.map(([label, val]) => <StatementRow key={label} label={label} value={val} pct={getPercentage(val)} indent negative />)}
                <StatementRow label="EBITDA" value={ebitda} pct={getPercentage(ebitda)} total />
                <StatementRow label="Depreciation" value={depreciation} pct={getPercentage(depreciation)} indent negative />
                <StatementRow label="Interest" value={interest} pct={getPercentage(interest)} indent negative />
                <StatementRow label="Tax" value={tax} pct={getPercentage(tax)} indent negative />
                <StatementRow label="NET INCOME" value={netIncome} pct={getPercentage(netIncome)} total />
              </tbody>
            </table>
          )}

          {activeTab === 'balance' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <BalanceSection title="Assets" rows={data?.balance?.assets || []} />
              <BalanceSection title="Liabilities" rows={data?.balance?.liabilities || []} />
              <BalanceSection title="Equity" rows={data?.balance?.equity || []} />
            </div>
          )}

          {activeTab === 'cashflow' && (
            <table className="w-full text-sm border-collapse">
              <thead className="border-b-2 border-slate-900"><tr><th className="text-left py-3">Cash Flow Area</th><th className="text-right py-3">Amount</th></tr></thead>
              <tbody className="divide-y divide-slate-200">
                <StatementRow label="Net cash from operating activities" value={safeNumber(cashFlow.operating)} />
                <StatementRow label="Net cash from investing activities" value={safeNumber(cashFlow.investing)} />
                <StatementRow label="Net cash from financing activities" value={safeNumber(cashFlow.financing)} />
                <StatementRow label="NET CASH MOVEMENT" value={safeNumber(cashFlow.operating) + safeNumber(cashFlow.investing) + safeNumber(cashFlow.financing)} total />
              </tbody>
            </table>
          )}

          {activeTab === 'ratios' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="border border-slate-200 rounded-xl p-5 bg-slate-50"><div className="text-xs uppercase text-slate-500 font-bold">Gross Margin</div><div className="text-3xl font-black text-slate-900 mt-2">{safeNumber(ratios.grossMargin).toFixed(1)}%</div></div>
              <div className="border border-slate-200 rounded-xl p-5 bg-slate-50"><div className="text-xs uppercase text-slate-500 font-bold">Net Margin</div><div className="text-3xl font-black text-slate-900 mt-2">{safeNumber(ratios.netMargin).toFixed(1)}%</div></div>
              <div className="border border-slate-200 rounded-xl p-5 bg-slate-50"><div className="text-xs uppercase text-slate-500 font-bold">DSCR</div><div className={`text-3xl font-black mt-2 ${safeNumber(ratios.dscr) >= 1.25 ? 'text-green-700' : 'text-red-700'}`}>{safeNumber(ratios.dscr).toFixed(2)}x</div><div className="text-xs text-slate-500 mt-2">Bank target: &gt; 1.25x</div></div>
            </div>
          )}

          {activeTab === 'notes' && (
            <div className="space-y-5 text-sm text-slate-700">
              <div className="border border-slate-200 rounded-xl p-4 bg-slate-50">
                <h3 className="font-bold text-slate-950 mb-2 flex items-center gap-2"><FileText size={16}/> Revenue Recognition</h3>
                <p>Recognized delivery revenue: <b>{formatCurrency(deliveryRecognized)}</b>. Delivered/invoiced revenue: <b>{formatCurrency(deliveryInvoiced)}</b>. Delivered but unpaid: <b>{formatCurrency(deliveryUnpaidDelivered)}</b>.</p>
              </div>
              <div className="border border-slate-200 rounded-xl p-4 bg-slate-50">
                <h3 className="font-bold text-slate-950 mb-2">COGS / Stock Basis</h3>
                <p>COGS: {safeNumber(data?.income?.cogs?.totalKgSold).toLocaleString()} kg × ₦{safeNumber(data?.income?.cogs?.avgCostPerKg).toFixed(2)} average cost/kg.</p>
              </div>
              {cautions.length > 0 && <div className="border border-amber-200 rounded-xl p-4 bg-amber-50"><h3 className="font-bold text-amber-900 mb-2 flex items-center gap-2"><AlertTriangle size={16}/> Notes / Cautions</h3><ul className="list-disc pl-5 space-y-1 text-amber-900">{cautions.map((c, idx) => <li key={idx}>{String(c)}</li>)}</ul></div>}
              <div className="border border-slate-200 rounded-xl p-4 bg-white">
                <h3 className="font-bold text-slate-950 mb-2 flex items-center gap-2"><CheckCircle2 size={16}/> Reversal Guidance</h3>
                <p>Financial statements are read-only. To reverse a journal, go to <b>Finance & ERP → GL Reversals</b>, select the date range/branch, click <b>Request reversal</b> against the posted journal, and approve the request using an authorized finance/admin user.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
