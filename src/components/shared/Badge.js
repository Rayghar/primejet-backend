import React from "react";

/**
 * Badge
 * - Small status/label chip used across GL-first screens.
 * Props:
 *  - tone: 'neutral' | 'good' | 'warn' | 'bad' | 'info'
 *  - children: label
 */
export default function Badge({ tone = "neutral", children, className = "" }) {
  const toneCls =
    tone === "good"
      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
      : tone === "warn"
      ? "bg-amber-500/10 border-amber-500/30 text-amber-300"
      : tone === "bad"
      ? "bg-rose-500/10 border-rose-500/30 text-rose-300"
      : tone === "info"
      ? "bg-sky-500/10 border-sky-500/30 text-sky-300"
      : "bg-white/5 border-white/10 text-slate-300";

  return (
    <span
      className={[
        "inline-flex items-center gap-1 px-2 py-1 rounded-full border text-[10px] font-semibold tracking-wide uppercase",
        toneCls,
        className,
      ].join(" ")}
    >
      {children}
    </span>
  );
}
