// Scheduled reminders.
//
// Currently: nudge staff to send their monthly timesheet the day BEFORE the month
// ends, so the office has every timesheet in hand for approval before month close.
//
// Design: run hourly, but a date guard means real reminders only go out on the
// reminder day. A per-staff, same-day dedupe (checked against the notifications
// table, not just memory) makes the job safe to run repeatedly and to survive a
// process restart on the host — a staff member is reminded at most once per day.
const prisma = require("./db");
const { localDate } = require("./clock");
const { notifyStaff } = require("./notify");

// Last calendar day of the month that `dateStr` (YYYY-MM-DD) falls in.
function lastDayOfMonth(dateStr) {
  const [y, m] = dateStr.split("-").map(Number);
  return new Date(y, m, 0).getDate(); // day 0 of the next month = last day of this one
}

// True when `dateStr` is exactly one day before its month ends.
function isDayBeforeMonthEnd(dateStr) {
  return Number(dateStr.slice(8, 10)) === lastDayOfMonth(dateStr) - 1;
}

// Send the reminder to every staff member who hasn't sent this month's timesheet.
// `todayOverride` (YYYY-MM-DD) exists only for tests; production passes nothing.
async function sendTimesheetReminders(todayOverride) {
  const today = todayOverride || localDate();  // London YYYY-MM-DD
  if (!isDayBeforeMonthEnd(today)) return 0;    // only the reminder day does anything
  const month = today.slice(0, 7);
  const monthName = new Date(month + "-01T00:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  // Dedupe window: this reminder only ever fires on ONE day per month, so any
  // timesheet reminder created in the last 2 days must be from today's run(s).
  // Using real elapsed time (not a date-string boundary) makes the hourly re-runs
  // idempotent and survives a host restart, without the London-midnight/UTC edge.
  const recentCutoff = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

  const staff = await prisma.staff.findMany({
    where: { accountRole: "STAFF", pendingActivation: false },
    select: { id: true },
  });

  let sent = 0;
  for (const s of staff) {
    // Already sent this month's timesheet → nothing to remind them about.
    const submitted = await prisma.timesheetEntry.count({ where: { staffId: s.id, status: "submitted", date: { startsWith: month } } });
    if (submitted > 0) continue;
    // Already reminded in this run window → skip (no double-send).
    const already = await prisma.notification.count({ where: { staffId: s.id, link: "timesheet", createdAt: { gte: recentCutoff } } });
    if (already > 0) continue;
    await notifyStaff(s.id, {
      type: "info",
      message: `Reminder: please send your ${monthName} timesheet before the month ends so it can be approved.`,
      link: "timesheet",
    });
    sent++;
  }
  if (sent > 0) console.log(`Timesheet reminders sent to ${sent} staff for ${month}`);
  return sent;
}

// Kick off the background scheduler. Hourly cadence; the date guard inside each run
// limits real work to the reminder day. unref() so the timer never keeps the
// process alive on its own.
function startScheduler() {
  const run = () => sendTimesheetReminders().catch((e) => console.error("scheduler run failed:", e.message));
  run(); // run once on boot (covers a deploy that happens on the reminder day)
  setInterval(run, 60 * 60 * 1000).unref();
  console.log("Scheduler: timesheet month-end reminders active (checks hourly)");
}

module.exports = { startScheduler, sendTimesheetReminders, isDayBeforeMonthEnd, lastDayOfMonth };
