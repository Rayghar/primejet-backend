import React from "react";
import Button from "./Button";

/**
 * EmptyState
 * - Friendly placeholder for empty lists and no-data screens.
 */
export default function EmptyState({
  title = "Nothing here yet",
  description = "When data becomes available, it will show up here.",
  icon: Icon,
  actionLabel,
  onAction,
  className = "",
}) {
  return (
    <div
      className={[
        "p-6 rounded-2xl border border-white/10 bg-white/5 text-center",
        className,
      ].join(" ")}
    >
      {Icon ? (
        <div className="mx-auto w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center mb-3">
          <Icon size={20} className="text-slate-300" />
        </div>
      ) : null}

      <div className="text-sm font-bold text-white">{title}</div>
      <div className="text-xs text-slate-400 mt-1">{description}</div>

      {actionLabel && typeof onAction === "function" ? (
        <div className="mt-4 flex justify-center">
          <Button onClick={onAction}>{actionLabel}</Button>
        </div>
      ) : null}
    </div>
  );
}
