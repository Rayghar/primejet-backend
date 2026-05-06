import React from "react";
import PostingStatusBadge from "./PostingStatusBadge";

/**
 * DateBranchBar (sticky)
 * - Shared top bar for GL-first workflow pages.
 *
 * Props:
 *  - businessDate, setBusinessDate
 *  - branchId, setBranchId
 *  - branches: [{id,name}]
 *  - approvalStatus, postingStatus, closeStatus
 *  - actions: [{ label, onClick, tone?, disabled?, icon? }]
 */
export default function DateBranchBar({
  businessDate,
  setBusinessDate,
  branchId,
  setBranchId,
  branches = [],
  approvalStatus,
  postingStatus,
  closeStatus,
  actions = [],
}) {
  const safeBranches = Array.isArray(branches) ? branches : [];

  return (
    <div className="sticky top-0 z-40 bg-[#0b1224]/95 backdrop-blur border-b border-white/10">
      <div className="px-4 py-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="text-[11px] text-slate-400">Business Date</div>
          <input
            type="date"
            value={businessDate || ""}
            onChange={(e) => setBusinessDate?.(e.target.value)}
            className="px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-slate-100 text-sm"
          />
        </div>

        <div className="flex items-center gap-2">
          <div className="text-[11px] text-slate-400">Branch</div>
          <select
            value={branchId || ""}
            onChange={(e) => setBranchId?.(e.target.value)}
            className="px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-slate-100 text-sm"
          >
            <option value="">Select branch…</option>
            {safeBranches.map((b) => (
              <option key={String(b.id)} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          {approvalStatus ? (
            <span className="text-[11px] text-slate-400">
              Approval: <span className="text-slate-200 font-mono">{String(approvalStatus)}</span>
            </span>
          ) : null}

          {postingStatus ? (
            <span className="flex items-center gap-2 text-[11px] text-slate-400">
              Posting: <PostingStatusBadge status={postingStatus} />
            </span>
          ) : null}

          {closeStatus ? (
            <span className="text-[11px] text-slate-400">
              Close: <span className="text-slate-200 font-mono">{String(closeStatus)}</span>
            </span>
          ) : null}
        </div>

        <div className="w-full md:w-auto md:ml-auto flex flex-wrap gap-2">
          {actions.map((a, idx) => {
            const tone = a.tone || "secondary";
            const base =
              tone === "primary"
                ? "bg-blue-600 hover:bg-blue-500 text-white"
                : tone === "danger"
                ? "bg-rose-600 hover:bg-rose-500 text-white"
                : "bg-white/5 hover:bg-white/10 text-slate-200 border border-white/10";
            const Icon = a.icon;
            return (
              <button
                key={idx}
                onClick={() => a.onClick?.()}
                disabled={Boolean(a.disabled)}
                className={[
                  "px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2",
                  base,
                  a.disabled ? "opacity-50 cursor-not-allowed" : "",
                ].join(" ")}
              >
                {Icon ? <Icon size={14} /> : null}
                {a.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
