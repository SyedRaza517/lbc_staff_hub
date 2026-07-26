// Shared numeric validation.
//
// Prisma's `Int` is a 32-bit column. SQLite is dynamically typed, so it will happily
// STORE a larger value — and then Prisma cannot read the row back, failing with
// P2023 "does not fit in an INT column". Every subsequent read of that table dies,
// so one oversized number permanently breaks a feature for everyone until the row
// is deleted by hand. Range-check before writing.
const INT32_MAX = 2147483647;
const INT32_MIN = -2147483648;

// A whole number safely inside the 32-bit column. Rejects NaN, Infinity, decimals,
// numeric strings that lose precision, and anything out of range.
function isInt32(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= INT32_MIN && n <= INT32_MAX;
}

// Business-sensible caps. A holiday allowance or adjustment in the thousands is
// already nonsense; these keep the numbers meaningful as well as storable.
const MAX_ALLOWANCE_DAYS = 3650;   // ten years
const MAX_ADJUSTMENT_DAYS = 3650;

// --- Text ---
// Several routes passed request values straight to Prisma after only a truthiness
// check. A number or object then threw inside Prisma, which surfaced as an opaque
// 500 (and, before wrapAsync, killed the process). Check the type, not just presence.
const isString = (v) => typeof v === "string";
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

// --- Dates ---
// A regex alone is not a date check: "2026-02-30" and "2039-04-31" match the shape,
// and V8's lenient parser rolls them over to 2 March / 1 May rather than returning
// Invalid Date. A record filed on a date that does not exist is invisible to any
// view that filters by the real date, so it can never be found and corrected.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function isRealDate(v) {
  if (!isString(v) || !DATE_RE.test(v)) return false;
  const d = new Date(v + "T00:00:00Z");
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

// Free-text fields staff can type. 2000 is the cap already used for a leave
// decision note; applying it consistently stops one person storing 100kB a day.
const MAX_TEXT = 2000;

// --- Sites ---
// Where a person works / clocks in. A closed set: it labels a check-in and is the
// staff member's home site. Validated so the column can only ever hold one of these.
const SITES = ["HND", "FE", "Online"];
// Accepts a site string or null/undefined (the field is always optional).
const isSite = (v) => v == null || (isString(v) && SITES.includes(v));

module.exports = {
  INT32_MAX, INT32_MIN, isInt32, MAX_ALLOWANCE_DAYS, MAX_ADJUSTMENT_DAYS,
  isString, isNonEmptyString, isRealDate, DATE_RE, MAX_TEXT,
  SITES, isSite,
};
