// File: src/views/01-Finance/PostingReadinessControl.js
import React, { useEffect, useMemo, useState } from 'react';
import PageTitle from '../../components/shared/PageTitle';
import Card from '../../components/shared/Card';
import Button from '../../components/shared/Button';
import { getPlants } from '../../api/operationsService';
import {
  glBootstrap,
  glPostApproved,
  glReadiness,
  glRetryFailed,
  glRunSafeSetup,
  glLockPeriod,
  glReopenPeriod,
} from '../../api/glService';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Database,
  FileText,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  Shield,
  XCircle,
} from 'lucide-react';

const todayIso = () => new Date().toISOString().slice(0, 10);
const monthStartIso = () => {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
};

const safeNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const statusStyle = (status) => {
  const s = String(status || '').toUpperCase();
  if (s === 'READY' || s === 'PASSED') return 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20';
  if (s === 'WARNING') return 'text-amber-300 bg-amber-500/10 border-amber-500/20';
  if (s === 'BLOCKED' || s === 'FAILED') return 'text-red-300 bg-red-500/10 border-red-500/20';
  return 'text-gray-300 bg-white/5 border-white/10';
};

const StatusIcon = ({ status, size = 18 }) => {
  const s = String(status || '').toUpperCase();
  if (s === 'READY' || s === 'PASSED') return <CheckCircle2 size={size} />;
  if (s === 'WARNING') return <AlertTriangle size={size} />;
  if (s === 'BLOCKED' || s === 'FAILED') return <XCircle size={size} />;
  return <Activity size={size} />;
};

const ControlCard = ({ control }) => {
  const status = String(control?.status || '').toUpperCase();
  return (
    <div className={`rounded-xl border p-4 ${statusStyle(status)}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <StatusIcon status={status} size={16} />
            {control?.label || 'Control'}
          </div>
          <div className="mt-1 text-xs opacity-90 leading-relaxed">{control?.message || 'No status message.'}</div>
        </div>
        <span className="shrink-0 rounded-full border border-current/20 px-2 py-1 text-[10px] font-bold uppercase">
          {status || 'UNKNOWN'}
        </span>
      </div>

      {control?.remediation ? (
        <div className="mt-3 rounded-lg bg-black/20 p-3 text-[11px] text-gray-200/90">
          <span className="font-semibold">Next step:</span> {control.remediation}
        </div>
      ) : null}
    </div>
  );
};

const CountTile = ({ label, value, hint }) => (
  <Card className="bg-white/5 border border-white/10 rounded-xl p-4">
    <div className="text-xs text-gray-400">{label}</div>
    <div className="mt-1 text-2xl font-bold text-white">{safeNum(value, 0).toLocaleString()}</div>
    {hint ? <div className="mt-1 text-[11px] text-gray-500">{hint}</div> : null}
  </Card>
);

export default function PostingReadinessControl({ setActiveView }) {
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState('');
  const [startDate, setStartDate] = useState(monthStartIso());
  const [endDate, setEndDate] = useState(todayIso());
  const [businessDate, setBusinessDate] = useState(todayIso());
  const [periodReason, setPeriodReason] = useState('');

  const [readiness, setReadiness] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState('');
  const [error, setError] = useState('');
  const [actionMessage, setActionMessage] = useState('');

  const status = String(readiness?.status || 'UNKNOWN').toUpperCase();
  const blocked = status === 'BLOCKED';

  const mandatoryControls = useMemo(() => readiness?.mandatoryControls || [], [readiness]);
  const recommendedControls = useMemo(() => readiness?.recommendedControls || [], [readiness]);

  const loadBranches = async () => {
    try {
      const plants = await getPlants();
      const normalized = Array.isArray(plants)
        ? plants
            .map((p) => ({ id: p?._id || p?.id, name: p?.name || 'Unnamed Branch' }))
            .filter((x) => x.id)
        : [];
      setBranches(normalized);
    } catch (e) {
      setBranches([]);
    }
  };

  const loadReadiness = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await glReadiness({
        startDate,
        endDate,
        branchIdOrZoneId: branchId || undefined,
      });
      setReadiness(res || null);
    } catch (e) {
      setReadiness(null);
      setError(e?.message || 'Failed to load posting readiness.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBranches();
  }, []);

  useEffect(() => {
    loadReadiness();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, startDate, endDate]);

  const runAction = async (key, fn, successMessage) => {
    setActionLoading(key);
    setActionMessage('');
    setError('');
    try {
      const res = await fn();
      setActionMessage(successMessage || res?.message || 'Action completed successfully.');
      if (res?.readiness) setReadiness(res.readiness);
      else await loadReadiness();
    } catch (e) {
      setError(e?.message || 'Action failed.');
    } finally {
      setActionLoading('');
    }
  };

  const runSafeSetup = () =>
    runAction(
      'safeSetup',
      () => glRunSafeSetup({ startDate, endDate, branchIdOrZoneId: branchId || undefined }),
      'Safe setup completed. GL bootstrap has been executed and readiness has been refreshed.'
    );

  const runBootstrap = () =>
    runAction('bootstrap', () => glBootstrap(), 'GL bootstrap completed. Required Chart of Accounts records have been created or refreshed.');

  const postApproved = () =>
    runAction(
      'postApproved',
      () => glPostApproved({ businessDate, branchIdOrZoneId: branchId || undefined }),
      `Approved records for ${businessDate} have been submitted to GL posting.`
    );

  const retryFailed = () =>
    runAction(
      'retryFailed',
      () => glRetryFailed({ startDate, endDate, branchIdOrZoneId: branchId || undefined }),
      'Failed GL postings have been retried for the selected period.'
    );

  const selectedPeriodKey = (startDate || businessDate || todayIso()).slice(0, 7);

  const lockCurrentPeriod = () =>
    runAction(
      'lockPeriod',
      () => glLockPeriod({ periodKey: selectedPeriodKey, reason: periodReason || 'Month-end finance lock' }),
      'Accounting period locked. Posting into this month is now blocked.'
    );

  const reopenCurrentPeriod = () =>
    runAction(
      'reopenPeriod',
      () => glReopenPeriod({ periodKey: selectedPeriodKey, reason: periodReason || 'Finance-approved reopen' }),
      'Accounting period reopened. Posting can resume for this month.'
    );

  const navigate = (view) => {
    if (typeof setActiveView === 'function') setActiveView(view);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <PageTitle
          title="Posting Readiness Control Center"
          subtitle="Run pre-posting checks and setup actions before sales, expenses and financial statements are posted."
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={RefreshCw} onClick={loadReadiness} disabled={loading || Boolean(actionLoading)}>
            Refresh Checks
          </Button>
          <Button icon={Shield} onClick={runSafeSetup} disabled={loading || Boolean(actionLoading)}>
            {actionLoading === 'safeSetup' ? 'Running...' : 'Run Safe Setup'}
          </Button>
        </div>
      </div>

      <Card className={`rounded-2xl border p-5 ${statusStyle(status)}`}>
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 items-center">
          <div className="lg:col-span-2">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-black/20 p-3">
                <StatusIcon status={status} size={28} />
              </div>
              <div>
                <div className="text-xs uppercase tracking-widest opacity-80">Posting readiness</div>
                <div className="text-3xl font-bold text-white">{status}</div>
              </div>
            </div>
            <div className="mt-3 text-sm opacity-90">
              {status === 'READY'
                ? 'The mandatory controls have passed. The system is ready for daily posting and GL actions.'
                : status === 'WARNING'
                  ? 'Mandatory controls passed, but some recommended controls require attention.'
                  : status === 'BLOCKED'
                    ? 'Mandatory setup is incomplete. Resolve blocked controls before GL posting.'
                    : 'Run readiness checks to confirm posting status.'}
            </div>
          </div>

          <div>
            <div className="text-xs uppercase tracking-widest opacity-70">Score</div>
            <div className="text-4xl font-bold text-white">{safeNum(readiness?.readinessScore, 0)}%</div>
          </div>

          <div className="text-sm">
            <div className="flex justify-between border-b border-white/10 py-1">
              <span>Mandatory</span>
              <span className="font-bold">{safeNum(readiness?.mandatoryPassed, 0)} / {safeNum(readiness?.mandatoryTotal, 0)}</span>
            </div>
            <div className="flex justify-between py-1">
              <span>Recommended</span>
              <span className="font-bold">{safeNum(readiness?.recommendedPassed, 0)} / {safeNum(readiness?.recommendedTotal, 0)}</span>
            </div>
          </div>
        </div>
      </Card>

      <Card className="bg-white/5 border border-white/10 rounded-xl p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div>
            <label className="text-xs text-gray-400">Branch / Plant</label>
            <select
              className="w-full mt-1 px-3 py-2 rounded-lg bg-black/30 text-white border border-white/10"
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
            >
              <option value="">All Branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs text-gray-400">Start Date</label>
            <input
              type="date"
              className="w-full mt-1 px-3 py-2 rounded-lg bg-black/30 text-white border border-white/10"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>

          <div>
            <label className="text-xs text-gray-400">End Date</label>
            <input
              type="date"
              className="w-full mt-1 px-3 py-2 rounded-lg bg-black/30 text-white border border-white/10"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>

          <div>
            <label className="text-xs text-gray-400">Posting Business Date</label>
            <input
              type="date"
              className="w-full mt-1 px-3 py-2 rounded-lg bg-black/30 text-white border border-white/10"
              value={businessDate}
              onChange={(e) => setBusinessDate(e.target.value)}
            />
          </div>
        </div>
      </Card>

      {error ? <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">{error}</div> : null}
      {actionMessage ? <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-200">{actionMessage}</div> : null}

      {loading ? (
        <div className="p-10 text-center text-blue-400 animate-pulse">Loading posting readiness...</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <CountTile label="COA Accounts Found" value={readiness?.counts?.coaAccountsFound} hint="Required and recommended accounts" />
            <CountTile label="Approved Unposted" value={readiness?.counts?.approvedUnposted} hint="Eligible records not yet posted" />
            <CountTile label="Failed Postings" value={readiness?.counts?.failedPostings} hint="Source documents needing retry/fix" />
            <CountTile label="Posted Journals" value={readiness?.counts?.postedJournalCount} hint="GL entries for selected scope" />
          </div>

          <Card className="bg-white/5 border border-white/10 rounded-xl p-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="text-lg font-bold text-white">Controlled Actions</div>
                <div className="text-xs text-gray-400 mt-1">
                  These actions run the backend setup/posting endpoints. Posting is disabled when mandatory readiness is blocked.
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" icon={Database} onClick={runBootstrap} disabled={Boolean(actionLoading)}>
                  {actionLoading === 'bootstrap' ? 'Bootstrapping...' : 'Run GL Bootstrap'}
                </Button>
                <Button icon={PlayCircle} onClick={postApproved} disabled={blocked || Boolean(actionLoading) || !businessDate}>
                  {actionLoading === 'postApproved' ? 'Posting...' : 'Post Approved Records'}
                </Button>
                <Button variant="secondary" icon={RotateCcw} onClick={retryFailed} disabled={Boolean(actionLoading) || !startDate || !endDate}>
                  {actionLoading === 'retryFailed' ? 'Retrying...' : 'Retry Failed'}
                </Button>
              </div>
            </div>

            {blocked ? (
              <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-100">
                GL posting is disabled because mandatory controls are blocked. Run Safe Setup or resolve the failed mandatory controls below.
              </div>
            ) : null}
          </Card>

          <Card className="bg-white/5 border border-white/10 rounded-xl p-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="text-lg font-bold text-white">Accounting Period Lock</div>
                <div className="text-xs text-gray-400 mt-1">Selected period: <span className="font-mono text-gray-200">{selectedPeriodKey}</span>. Locking blocks posting, rebuilds, retries and reversals for that month.</div>
              </div>
              <div className="flex flex-wrap gap-2 items-end">
                <input className="px-3 py-2 rounded-lg bg-black/30 text-white border border-white/10 text-sm" placeholder="Reason required for audit" value={periodReason} onChange={(e) => setPeriodReason(e.target.value)} />
                <Button variant="secondary" onClick={lockCurrentPeriod} disabled={Boolean(actionLoading)}>Lock Period</Button>
                <Button variant="secondary" onClick={reopenCurrentPeriod} disabled={Boolean(actionLoading)}>Reopen Period</Button>
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card className="bg-white/5 border border-white/10 rounded-xl p-4">
              <div className="flex items-center gap-2 text-white font-bold mb-4">
                <Shield size={18} /> Mandatory Controls
              </div>
              <div className="space-y-3">
                {mandatoryControls.length ? mandatoryControls.map((c) => <ControlCard key={c.key} control={c} />) : <div className="text-sm text-gray-400">No mandatory controls returned.</div>}
              </div>
            </Card>

            <Card className="bg-white/5 border border-white/10 rounded-xl p-4">
              <div className="flex items-center gap-2 text-white font-bold mb-4">
                <AlertTriangle size={18} /> Recommended Controls
              </div>
              <div className="space-y-3">
                {recommendedControls.length ? recommendedControls.map((c) => <ControlCard key={c.key} control={c} />) : <div className="text-sm text-gray-400">No recommended controls returned.</div>}
              </div>
            </Card>
          </div>

          {readiness?.blockedReasons?.length ? (
            <Card className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
              <div className="text-sm font-bold text-red-200 flex items-center gap-2"><XCircle size={16} /> Blocked Reasons</div>
              <ul className="mt-2 list-disc pl-5 text-xs text-red-100/90 space-y-1">
                {readiness.blockedReasons.map((w, idx) => <li key={idx}>{w}</li>)}
              </ul>
            </Card>
          ) : null}

          {readiness?.warnings?.length ? (
            <Card className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
              <div className="text-sm font-bold text-amber-200 flex items-center gap-2"><AlertTriangle size={16} /> Warnings</div>
              <ul className="mt-2 list-disc pl-5 text-xs text-amber-100/90 space-y-1">
                {readiness.warnings.map((w, idx) => <li key={idx}>{w}</li>)}
              </ul>
            </Card>
          ) : null}

          <Card className="bg-white/5 border border-white/10 rounded-xl p-4">
            <div className="flex items-center gap-2 text-white font-bold mb-3">
              <FileText size={18} /> Navigation
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <Button variant="secondary" icon={ArrowRight} onClick={() => navigate('CloseWorkspace')}>Close Workspace</Button>
              <Button variant="secondary" icon={ArrowRight} onClick={() => navigate('TrialBalance')}>Trial Balance</Button>
              <Button variant="secondary" icon={ArrowRight} onClick={() => navigate('GLHealth')}>GL Health</Button>
              <Button variant="secondary" icon={ArrowRight} onClick={() => navigate('FinancialStatements')}>Financial Statements</Button>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
