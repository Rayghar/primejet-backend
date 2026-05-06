import React from "react";
import { X } from "lucide-react";
import GLPreviewPanel from "./GLPreviewPanel";

/**
 * JournalViewerModal
 * - Minimal viewer for a posted GL entry (lines + header info).
 *
 * Props:
 *  - open
 *  - entry: { _id, date, narration, sourceType, sourceId, lines }
 *  - onClose
 */
export default function JournalViewerModal({ open, entry, onClose }) {
  if (!open) return null;

  const e = entry || {};
  const dt = e?.date ? new Date(e.date) : null;
  const dateLabel = dt && !Number.isNaN(dt.getTime()) ? dt.toISOString().slice(0, 10) : "—";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative w-[95vw] max-w-3xl max-h-[85vh] overflow-auto rounded-2xl border border-white/10 bg-[#0b1224] p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-white font-extrabold">GL Journal</div>
            <div className="text-[11px] text-slate-400 mt-1">
              Date: <span className="text-slate-200 font-mono">{dateLabel}</span> •{" "}
              Source: <span className="text-slate-200 font-mono">{e.sourceType || "—"}</span> •{" "}
              Ref: <span className="text-slate-200 font-mono">{e.sourceId || "—"}</span>
            </div>
            {e.narration ? <div className="text-xs text-slate-300 mt-2">{e.narration}</div> : null}
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-4">
          <GLPreviewPanel title="Journal Lines" lines={Array.isArray(e.lines) ? e.lines : []} />
        </div>
      </div>
    </div>
  );
}
