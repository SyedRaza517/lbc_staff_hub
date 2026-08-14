// Attendance Emails — the admin tool + automated month-end recognition/engagement emails.
//
// Students are banded by their attendance % for the CURRENT semester (see
// attendanceBands.js), and each band has its own editable email template. At month-end
// (or on a manual "send now") every current-semester student is emailed the template for
// their band, personalised with their overall % and a per-module breakdown. The compute
// and send live in attendanceEmailService.js; the config + monthly run in
// attendanceRunner.js. This router is the admin surface, gated on "attendance-emails".
const router = require("express").Router();
const { requireAuth, requirePage } = require("../auth");
const service = require("../attendanceEmailService");
const runner = require("../attendanceRunner");
const bands = require("../attendanceBands");

router.use(requireAuth, requirePage("attendance-emails"));

// GET /data — the current semester, every active student's attendance (overall % + band
// + per-module), and a per-band headcount. Empty when there is no current semester.
router.get("/data", async (_req, res) => {
  const semester = await service.currentSemester();
  if (!semester) {
    return res.json({ semester: null, period: "", bands: bands.BANDS.map((b) => ({ ...b, count: 0 })), students: [] });
  }
  const { period, students } = await service.computeSemesterAttendance(semester);
  const counts = {};
  for (const s of students) if (s.bandKey) counts[s.bandKey] = (counts[s.bandKey] || 0) + 1;
  res.json({
    semester: { id: semester.id, name: semester.name, start: semester.start, end: semester.end },
    period,
    bands: bands.BANDS.map((b) => ({ ...b, count: counts[b.key] || 0 })),
    students,
  });
});

// GET /config — the resolved config (stored blob merged over the code defaults).
router.get("/config", async (_req, res) => {
  res.json(await runner.loadConfig());
});

// PUT /config — save any of automation / respondDays / sendHour / institution values /
// band templates. Missing keys are left untouched (deep-merged in the runner).
router.put("/config", async (req, res) => {
  const b = req.body || {};
  const patch = {};
  if (b.autoEnabled != null) patch.autoEnabled = !!b.autoEnabled;
  if (b.respondDays != null) patch.respondDays = Math.max(1, Math.min(30, Number(b.respondDays) || 5));
  if (b.sendHour != null) patch.sendHour = Math.max(0, Math.min(23, Number(b.sendHour) || 9));
  if (b.values && typeof b.values === "object") patch.values = b.values;
  if (b.templates && typeof b.templates === "object") patch.templates = b.templates;
  res.json(await runner.saveConfig(patch));
});

// POST /run — send this month's emails now. A manual press defaults to force (ignore the
// once-a-month de-dupe); pass { force:false } to respect it.
router.post("/run", async (req, res) => {
  const force = req.body?.force !== false;
  const out = await runner.runMonthly({ force });
  if (!out.ok && out.reason === "no-current-semester") {
    return res.status(400).json({ error: "There is no current semester right now, so there is nothing to send." });
  }
  res.json(out);
});

module.exports = router;
