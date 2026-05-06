import React from "react";

/**
 * ConfirmDialog
 * - Minimal confirm modal (no external deps).
 *
 * Props:
 *  - open: boolean
 *  - title: string
 *  - message: string|ReactNode
 *  - confirmText/cancelText
 *  - tone: 'danger'|'primary'
 *  - onConfirm/onCancel
 */
export default function ConfirmDialog({
  open,
  title = "Confirm",
  message = "Are you sure?",
  confirmText = "Confirm",
  cancelText = "Cancel",
  tone = "primary",
  onConfirm,
  onCancel,
}) {
  if (!open) return null;

  const confirmCls =
    tone === "danger"
      ? "bg-rose-600 hover:bg-rose-500"
      : "bg-blue-600 hover:bg-blue-500";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/70"
        onClick={() => onCancel?.()}
      />
      <div className="relative w-[92vw] max-w-md rounded-2xl border border-white/10 bg-[#0b1224] p-5 shadow-2xl">
        <div className="text-white font-extrabold">{title}</div>
        <div className="text-sm text-slate-300 mt-2">{message}</div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={() => onCancel?.()}
            className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-slate-200 hover:bg-white/10"
          >
            {cancelText}
          </button>
          <button
            onClick={() => onConfirm?.()}
            className={["px-4 py-2 rounded-xl text-white font-semibold", confirmCls].join(" ")}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
