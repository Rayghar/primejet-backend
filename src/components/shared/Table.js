import React from "react";
import EmptyState from "./EmptyState";

/**
 * Table
 * - Generic table renderer for GL screens.
 *
 * Props:
 *  - columns: [{ key, header, render?(row), className?, headerClassName? }]
 *  - rows: array
 *  - emptyTitle/emptyDescription
 *  - onRowClick?(row)
 */
export default function Table({
  columns = [],
  rows = [],
  emptyTitle = "No records",
  emptyDescription = "Try adjusting your filters.",
  onRowClick,
  className = "",
}) {
  const safeRows = Array.isArray(rows) ? rows : [];

  if (safeRows.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} className={className} />;
  }

  return (
    <div className={["overflow-auto rounded-2xl border border-white/10", className].join(" ")}>
      <table className="min-w-full text-sm">
        <thead className="bg-white/5">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={[
                  "text-left px-4 py-3 text-[11px] uppercase tracking-widest text-slate-400 font-semibold",
                  c.headerClassName || "",
                ].join(" ")}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {safeRows.map((row, idx) => (
            <tr
              key={row?.id ?? row?._id ?? idx}
              className={[
                "hover:bg-white/5",
                typeof onRowClick === "function" ? "cursor-pointer" : "",
              ].join(" ")}
              onClick={() => onRowClick?.(row)}
            >
              {columns.map((c) => (
                <td key={c.key} className={["px-4 py-3 text-slate-200", c.className || ""].join(" ")}>
                  {typeof c.render === "function" ? c.render(row) : String(row?.[c.key] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
