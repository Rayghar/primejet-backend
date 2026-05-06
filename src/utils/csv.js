// utils/csv.js
// Lightweight CSV export helper (no deps).
// Usage: downloadCsv("trial_balance.csv", rows, columns)

const escapeCell = (v) => {
  const s = String(v ?? "");
  // Escape quotes and wrap if needed
  const needs = /[",\n]/.test(s);
  const esc = s.replace(/"/g, '""');
  return needs ? `"${esc}"` : esc;
};

export const toCsv = (rows, columns) => {
  const cols = Array.isArray(columns) ? columns : [];
  const data = Array.isArray(rows) ? rows : [];
  const header = cols.map((c) => escapeCell(c.label ?? c.key)).join(",");
  const lines = data.map((r) => cols.map((c) => escapeCell(typeof c.get === "function" ? c.get(r) : r?.[c.key])).join(","));
  return [header, ...lines].join("\n");
};

export const downloadCsv = (filename, rows, columns) => {
  const csv = toCsv(rows, columns);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "export.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
};
