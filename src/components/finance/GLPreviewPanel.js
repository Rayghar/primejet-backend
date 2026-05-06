import React from "react";
import { formatCurrency } from "../../utils/formatters";
import Table from "../shared/Table";

/**
 * GLPreviewPanel
 * - Shows the exact journal lines to be posted (Dr/Cr).
 */
export default function GLPreviewPanel({ title = "GL Posting Preview", lines = [], className = "" }) {
  const rows = Array.isArray(lines) ? lines : [];
  const totalDebit = rows.reduce((s, l) => s + Number(l.debit || 0), 0);
  const totalCredit = rows.reduce((s, l) => s + Number(l.credit || 0), 0);
  const balanced = Math.abs(totalDebit - totalCredit) <= 0.5;

  return (
    <div className={["rounded-2xl border border-white/10 bg-white/5 p-4", className].join(" ")}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-extrabold text-white">{title}</div>
        <div className="text-[11px] text-slate-400">
          Debit: <span className="text-slate-200 font-mono">{formatCurrency(totalDebit)}</span>{" "}
          • Credit: <span className="text-slate-200 font-mono">{formatCurrency(totalCredit)}</span>{" "}
          •{" "}
          <span className={balanced ? "text-emerald-300" : "text-rose-300"}>
            {balanced ? "BALANCED" : "UNBALANCED"}
          </span>
        </div>
      </div>

      <div className="mt-3">
        <Table
          columns={[
            { key: "accountCode", header: "Account" },
            { key: "accountName", header: "Name", render: (r) => r.accountName || "—" },
            { key: "narration", header: "Narration", render: (r) => r.narration || "—" },
            { key: "debit", header: "Debit", className: "text-right font-mono", render: (r) => formatCurrency(r.debit || 0) },
            { key: "credit", header: "Credit", className: "text-right font-mono", render: (r) => formatCurrency(r.credit || 0) },
          ]}
          rows={rows}
          emptyTitle="No journal lines"
          emptyDescription="This record will not post anything to GL."
        />
      </div>
    </div>
  );
}
