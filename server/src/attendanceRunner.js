// Automated monthly attendance emails — config persistence + the monthly run.
//
// This sits between the compute/send core (attendanceEmailService.js) and its two
// callers: the admin routes (routes/attendanceEmails.js) and the in-process scheduler
// (attendanceScheduler.js). It owns the single AttendanceEmailConfig row (the editable
// templates, institution values and automation settings) and the once-a-month send,
// which is de-duplicated on a YYYY-MM period so a restart on the last day of the month
// can never double-send.
const prisma = require("./db");
const bands = require("./attendanceBands");
const service = require("./attendanceEmailService");

const CONFIG_ID = "singleton";

// Merge a stored config blob over the code defaults so callers always receive a complete
// config (every band template present, every institution value present).
function resolveConfig(data) {
  const d = data || {};
  const templates = {};
  for (const b of bands.BANDS) {
    const saved = d.templates && d.templates[b.key];
    const def = bands.DEFAULT_TEMPLATES[b.key] || { subject: "", body: "" };
    templates[b.key] = {
      subject: saved && saved.subject != null ? saved.subject : def.subject,
      body: saved && saved.body != null ? saved.body : def.body,
    };
  }
  return {
    autoEnabled: !!d.autoEnabled,
    respondDays: Number.isFinite(d.respondDays) ? d.respondDays : 5,
    sendHour: Number.isFinite(d.sendHour) ? d.sendHour : 9,
    lastRunPeriod: d.lastRunPeriod || null,
    values: { ...bands.DEFAULT_VALUES, ...(d.values || {}) },
    templates,
  };
}

async function loadConfig() {
  const row = await prisma.attendanceEmailConfig.findUnique({ where: { id: CONFIG_ID } }).catch(() => null);
  return resolveConfig(row && row.data);
}

// Shallow-merge the patch over the stored blob; `values` and `templates` merge one level
// deeper so saving one band's template (or one value) doesn't wipe the others.
async function saveConfig(patch = {}) {
  const row = await prisma.attendanceEmailConfig.findUnique({ where: { id: CONFIG_ID } }).catch(() => null);
  const cur = (row && row.data) || {};
  const next = { ...cur, ...patch };
  if (patch.values) next.values = { ...(cur.values || {}), ...patch.values };
  if (patch.templates) next.templates = { ...(cur.templates || {}), ...patch.templates };
  await prisma.attendanceEmailConfig.upsert({
    where: { id: CONFIG_ID },
    create: { id: CONFIG_ID, data: next },
    update: { data: next },
  });
  return resolveConfig(next);
}

// The date `n` working days (Mon–Fri) ahead of `from`, for the "respond by" line.
function addWorkingDays(from, n) {
  const d = new Date(from);
  let added = 0;
  while (added < n) { d.setDate(d.getDate() + 1); const wd = d.getDay(); if (wd !== 0 && wd !== 6) added++; }
  return d;
}
const WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MO = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const fmtDate = (d) => `${WD[d.getDay()]}, ${d.getDate()} ${MO[d.getMonth()]} ${d.getFullYear()}`;
const ymPeriod = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

// Send the monthly banded emails to every current-semester student. De-duplicates on the
// YYYY-MM period (skips if already run this month) unless `force` — a manual "send now"
// press passes force:true. Returns { ok, reason?, period, semester?, sent, failed, skipped, ... }.
async function runMonthly({ force = false } = {}) {
  const semester = await service.currentSemester();
  if (!semester) return { ok: false, reason: "no-current-semester" };

  const now = new Date();
  const period = ymPeriod(now);
  const config = await loadConfig();
  if (!force && config.lastRunPeriod === period) return { ok: false, reason: "already-run", period };

  const { period: periodLabel, students } = await service.computeSemesterAttendance(semester);
  const respondByDate = fmtDate(addWorkingDays(now, config.respondDays));
  const summary = await service.sendToStudents(students, config, { period: periodLabel, respondByDate });

  await saveConfig({ lastRunPeriod: period });
  return { ok: true, period, semester: semester.name, ...summary };
}

module.exports = { loadConfig, saveConfig, resolveConfig, runMonthly, ymPeriod };
