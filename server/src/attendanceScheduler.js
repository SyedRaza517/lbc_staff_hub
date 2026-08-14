// In-process scheduler for the automated month-end attendance emails.
//
// No external cron service is needed. It wakes hourly and, only when automation is
// switched on, sends the banded attendance emails on the LAST calendar day of each month
// at/after the configured hour. The actual send is de-duplicated on the YYYY-MM period in
// attendanceRunner.runMonthly, so a restart mid-day (or an extra tick) can't double-send.
// Everything is gated by config: with automation off (the default) this does nothing.
const runner = require("./attendanceRunner");

// True when `d` is the last day of its month (tomorrow rolls into a new month).
function isLastDayOfMonth(d) {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  return t.getMonth() !== d.getMonth();
}

async function tick() {
  try {
    const config = await runner.loadConfig();
    if (!config.autoEnabled) return;
    const now = new Date();
    if (!isLastDayOfMonth(now)) return;
    if (now.getHours() < (config.sendHour != null ? config.sendHour : 9)) return;
    const out = await runner.runMonthly({ force: false }); // de-dupe handled inside
    if (out.ok) {
      console.log(`[attendance-scheduler] ${out.period}: ${out.sent} sent, ${out.failed} failed, ${out.skipped} skipped`);
    }
  } catch (e) {
    console.error("[attendance-scheduler]", e && e.message ? e.message : e);
  }
}

function start() {
  setInterval(tick, 60 * 60 * 1000); // hourly
  setTimeout(tick, 30 * 1000);        // and once ~30s after boot, in case we start on month-end
  console.log("[attendance-scheduler] started — month-end attendance emails (enable in the Attendance Emails tab)");
}

module.exports = { start, tick, isLastDayOfMonth };
