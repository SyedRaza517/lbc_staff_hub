// UK (England & Wales) statutory bank holidays — server copy of the client's
// engine (client/src/bankHolidays.js). Kept in sync deliberately; both compute the
// standard 8 per year with weekend substitution. Used to auto-approve a leave
// request that falls entirely on bank holidays (no manager step needed).

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

// The 8 England & Wales bank holiday dates ('YYYY-MM-DD') for a year.
function ukBankHolidays(year) {
  const easter = easterSunday(year);
  const dow25 = mkUTC(year, 11, 25).getUTCDay();
  let xmasDay = 25, boxDay = 26;
  if (dow25 === 6) { xmasDay = 27; boxDay = 28; }
  else if (dow25 === 0) { xmasDay = 27; boxDay = 26; }
  else if (dow25 === 5) { boxDay = 28; }
  return [
    substitute(mkUTC(year, 0, 1)),
    addDays(easter, -2),
    addDays(easter, 1),
    firstMondayOf(year, 4),
    lastMondayOf(year, 4),
    lastMondayOf(year, 7),
    mkUTC(year, 11, xmasDay),
    mkUTC(year, 11, boxDay),
  ].map(iso);
}

// True when EVERY calendar day in the inclusive [start, end] range is a bank holiday.
function allDatesAreBankHolidays(start, end) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) return false;
  const y0 = Number(start.slice(0, 4)), y1 = Number(end.slice(0, 4));
  const set = new Set();
  for (let y = y0; y <= y1; y++) for (const d of ukBankHolidays(y)) set.add(d);
  let cur = new Date(start + "T00:00:00Z");
  const last = new Date(end + "T00:00:00Z");
  if (isNaN(cur) || isNaN(last)) return false;
  while (cur <= last) {
    if (!set.has(cur.toISOString().slice(0, 10))) return false;
    cur = new Date(cur.getTime() + 86400000);
  }
  return true;
}

module.exports = { ukBankHolidays, allDatesAreBankHolidays };
