/* ============================================================
   csv.js — dependency-free CSV helpers for the Staff Hub
   ============================================================ */

// Escape a single CSV cell value. Coerces null/undefined to "".
// Wraps in double quotes (doubling any internal quotes) when the value
// contains a comma, double-quote, or newline.
function escapeCell(value) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Build a CSV string from columns ({ key, label }) and rows (array of objects).
// Header row uses the column labels; each data row pulls values by column key.
export function toCSV(columns, rows) {
  const cols = columns || [];
  const data = rows || [];
  const header = cols.map(c => escapeCell(c.label)).join(",");
  const body = data.map(row => cols.map(c => escapeCell(row[c.key])).join(","));
  return [header, ...body].join("\r\n");
}

// Build the CSV and trigger a browser download via a temporary <a download>.
export function downloadCSV(filename, columns, rows) {
  const csv = toCSV(columns, rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "export.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
