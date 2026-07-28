// UK (England & Wales) statutory bank holidays — the standard 8 per year, computed
// so the calendar and leave balances stay correct every year with no data entry.
// Weekend holidays roll to a substitute weekday, following gov.uk's rules.

const mkUTC = (y, m, d) => new Date(Date.UTC(y, m, d));
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => mkUTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n);

// Anonymous Gregorian (Meeus/Jones/Butcher) algorithm → Easter Sunday for a year.
function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return mkUTC(year, month - 1, day);
}
// First / last Monday of a 0-indexed month.
const firstMondayOf = (year, month) => { const d = mkUTC(year, month, 1); return addDays(d, (8 - d.getUTCDay()) % 7); };
const lastMondayOf = (year, month) => { const d = mkUTC(year, month + 1, 0); return addDays(d, -((d.getUTCDay() + 6) % 7)); };
// A fixed-date holiday rolls to the next weekday if it lands on a weekend.
const substitute = (d) => { const wd = d.getUTCDay(); return wd === 6 ? addDays(d, 2) : wd === 0 ? addDays(d, 1) : d; };

// The 8 England & Wales bank holidays for `year`, as { date: 'YYYY-MM-DD', name }.
export function ukBankHolidays(year) {
  const easter = easterSunday(year);
  // Christmas & Boxing Day substitution interact, so resolve them together.
  const dow25 = mkUTC(year, 11, 25).getUTCDay();
  let xmasDay = 25, boxDay = 26;
  if (dow25 === 6) { xmasDay = 27; boxDay = 28; }        // Christmas on Sat
  else if (dow25 === 0) { xmasDay = 27; boxDay = 26; }   // Christmas on Sun (Boxing Mon 26)
  else if (dow25 === 5) { boxDay = 28; }                 // Christmas Fri, Boxing Sat → Mon 28

  const list = [
    { name: "New Year's Day", date: substitute(mkUTC(year, 0, 1)) },
    { name: "Good Friday", date: addDays(easter, -2) },
    { name: "Easter Monday", date: addDays(easter, 1) },
    { name: "Early May bank holiday", date: firstMondayOf(year, 4) },
    { name: "Spring bank holiday", date: lastMondayOf(year, 4) },
    { name: "Summer bank holiday", date: lastMondayOf(year, 7) },
    { name: "Christmas Day", date: mkUTC(year, 11, xmasDay) },
    { name: "Boxing Day", date: mkUTC(year, 11, boxDay) },
  ];
  return list
    .map((h) => ({ name: h.name, date: iso(h.date) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Bank holidays across a small span of years, so the calendar can page forwards/back.
export function ukBankHolidaysRange(fromYear, toYear) {
  const out = [];
  for (let y = fromYear; y <= toYear; y++) out.push(...ukBankHolidays(y));
  return out;
}
