// UK (England & Wales) statutory bank holidays — server copy of the client's
// engine (client/src/bankHolidays.js). Kept in sync deliberately; both compute the
// standard 8 per year with weekend substitution. Used to work out which days in a
// leave range are chargeable (bank holidays and weekends never are).

const mkUTC = (y, m, d) => new Date(Date.UTC(y, m, d));
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => mkUTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n);

function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return mkUTC(year, month - 1, day);
}
const firstMondayOf = (year, month) => { const d = mkUTC(year, month, 1); return addDays(d, (8 - d.getUTCDay()) % 7); };
const lastMondayOf = (year, month) => { const d = mkUTC(year, month + 1, 0); return addDays(d, -((d.getUTCDay() + 6) % 7)); };
const substitute = (d) => { const wd = d.getUTCDay(); return wd === 6 ? addDays(d, 2) : wd === 0 ? addDays(d, 1) : d; };

// One-off royal bank holidays, which no rule can derive.
//
// The generator computes the standard 8 correctly, but Parliament grants extra days
// for events like a jubilee or a coronation, and moves the spring holiday to suit.
// Without these, backfilling historical leave over-charges staff: 30 May – 3 Jun 2022
// came out as 4 chargeable days when only Tuesday 31 May was actually workable.
// Verified against gov.uk. Add future one-offs here as they are announced.
const ONE_OFFS = {
  2022: { add: ["2022-06-02", "2022-06-03"], remove: ["2022-05-30"] },  // Platinum Jubilee
  2023: { add: ["2023-05-08"], remove: [] },                            // Coronation
};

// The England & Wales bank holiday dates ('YYYY-MM-DD') for a year — normally 8.
function ukBankHolidays(year) {
  const easter = easterSunday(year);
  const dow25 = mkUTC(year, 11, 25).getUTCDay();
  let xmasDay = 25, boxDay = 26;
  if (dow25 === 6) { xmasDay = 27; boxDay = 28; }
  else if (dow25 === 0) { xmasDay = 27; boxDay = 26; }
  else if (dow25 === 5) { boxDay = 28; }
  const base = [
    substitute(mkUTC(year, 0, 1)),
    addDays(easter, -2),
    addDays(easter, 1),
    firstMondayOf(year, 4),
    lastMondayOf(year, 4),
    lastMondayOf(year, 7),
    mkUTC(year, 11, xmasDay),
    mkUTC(year, 11, boxDay),
  ].map(iso);
  const oneOff = ONE_OFFS[year];
  if (!oneOff) return base;
  return [...base.filter((d) => !oneOff.remove.includes(d)), ...oneOff.add].sort();
}

// The same England & Wales bank holidays as ukBankHolidays(), but each carried with its
// canonical name — [{ date: 'YYYY-MM-DD', name }] — for messaging (e.g. the automated
// "college closed tomorrow" reminder). Re-uses the exact date computations above so the
// two never drift; when a day is moved to a weekday substitute (New Year, Christmas,
// Boxing Day) the name is suffixed "(substitute day)".
function namedUkBankHolidays(year) {
  const easter = easterSunday(year);

  // Christmas/Boxing Day substitution — identical rule to ukBankHolidays().
  const dow25 = mkUTC(year, 11, 25).getUTCDay();
  let xmasDay = 25, boxDay = 26;
  if (dow25 === 6) { xmasDay = 27; boxDay = 28; }      // Christmas on Saturday
  else if (dow25 === 0) { xmasDay = 27; boxDay = 26; } // Christmas on Sunday
  else if (dow25 === 5) { boxDay = 28; }               // Christmas on Friday → Boxing Day slips to Monday

  // New Year's Day, with its own weekend → weekday substitution.
  const nyd = mkUTC(year, 0, 1);
  const nydObserved = substitute(nyd);

  const entries = [
    { date: iso(nydObserved),
      name: iso(nydObserved) !== iso(nyd) ? "New Year's Day (substitute day)" : "New Year's Day" },
    { date: iso(addDays(easter, -2)), name: "Good Friday" },
    { date: iso(addDays(easter, 1)),  name: "Easter Monday" },
    { date: iso(firstMondayOf(year, 4)), name: "Early May bank holiday" },
    { date: iso(lastMondayOf(year, 4)),  name: "Spring bank holiday" },
    { date: iso(lastMondayOf(year, 7)),  name: "Summer bank holiday" },
    { date: iso(mkUTC(year, 11, xmasDay)),
      name: xmasDay !== 25 ? "Christmas Day (substitute day)" : "Christmas Day" },
    { date: iso(mkUTC(year, 11, boxDay)),
      name: boxDay !== 26 ? "Boxing Day (substitute day)" : "Boxing Day" },
  ];

  // Fold in the same one-off royal holidays ukBankHolidays() applies, so the date set of
  // the two stays identical. Their names can't be derived by rule, so use a best-effort label.
  const oneOff = ONE_OFFS[year];
  if (!oneOff) return entries;
  const kept = entries.filter((e) => !oneOff.remove.includes(e.date));
  const added = oneOff.add.map((date) => ({ date, name: "Bank holiday" }));
  return [...kept, ...added].sort((a, b) => a.date.localeCompare(b.date));
}

// Days actually charged against the bookable allowance for an inclusive [start,end]
// range: Monday–Friday only, excluding bank holidays. Weekends (Sat/Sun) and bank
// holidays inside the range are free and never deducted. Mirrors the client's
// chargeableDays (store.js) so both sides agree on what a booking costs.
// `year` (optional, e.g. 2026 or "2026") counts only the days that fall in that
// calendar year. The allowance is per leave year, so a booking that straddles New
// Year must charge each year the days it actually uses — attributing the whole
// booking to its start year let one 20-day entitlement cover a run of leave that
// mostly fell in the following year.
// A hard ceiling on the range this will walk.
//
// This is an O(days) synchronous loop that also builds a bank-holiday table per year
// in the span, and Node is single-threaded. An unbounded range is therefore a total
// outage, not a slow request: "2026-08-10" → "9999-12-31" is 2,016,373 days, measured
// at 8.5 SECONDS of fully blocked event loop on a dev machine — and the approval path
// re-walks the range once per year spanned (7,974 of them), which is hours.
//
// The route layer rejects long ranges with a readable message; this exists so that a
// caller which forgets to cannot take the API down. Returning 0 is deliberate: every
// caller already treats 0 as "nothing chargeable", so a slipped-through absurd range
// degrades to a harmless no-op rather than a crash.
const MAX_SPAN_DAYS = 800;

function chargeableDays(start, end, year) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) return 0;
  if (spanDays(start, end) > MAX_SPAN_DAYS) return 0;
  const y0 = Number(start.slice(0, 4)), y1 = Number(end.slice(0, 4));
  const set = new Set();
  for (let y = y0; y <= y1; y++) for (const d of ukBankHolidays(y)) set.add(d);
  let cur = new Date(start + "T00:00:00Z");
  const last = new Date(end + "T00:00:00Z");
  if (isNaN(cur) || isNaN(last)) return 0;
  const wantYear = year == null ? null : String(year);
  let n = 0;
  while (cur <= last) {
    const iso = cur.toISOString().slice(0, 10);
    const dow = cur.getUTCDay(); // 0 = Sun … 6 = Sat
    if (dow !== 0 && dow !== 6 && !set.has(iso) && (wantYear === null || iso.slice(0, 4) === wantYear)) n += 1;
    cur = new Date(cur.getTime() + 86400000);
  }
  return n;
}

// The distinct calendar years an inclusive range touches, e.g. ["2026","2027"].
function yearsSpanned(start, end) {
  const y0 = Number(String(start).slice(0, 4)), y1 = Number(String(end).slice(0, 4));
  if (!Number.isFinite(y0) || !Number.isFinite(y1) || y1 < y0) return [];
  const out = [];
  for (let y = y0; y <= y1; y++) out.push(String(y));
  return out;
}

// Number of bank holidays in a year (normally 8) — the size of the bank-holiday pot
// that is carved out of the total entitlement and is never bookable.
function bankHolidayCount(year) {
  return ukBankHolidays(year).length;
}

// Inclusive day count between two YYYY-MM-DD dates, computed arithmetically rather
// than by walking — so it is safe to call on a range before deciding whether the
// range is safe to walk.
function spanDays(start, end) {
  const a = Date.parse(`${start}T00:00:00Z`), b = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.floor((b - a) / 86400000) + 1;
}

module.exports = { ukBankHolidays, namedUkBankHolidays, chargeableDays, bankHolidayCount, yearsSpanned, spanDays, MAX_SPAN_DAYS };
