// Staff timesheets.
//
// Each row is one class/work session: a date, start & end time, whether it was on
// campus or online, and a title. Staff add entries as "draft"; "Send timesheet"
// flips a whole month's entries to "submitted" and notifies admins, who can review
// them on the dashboard. Times and dates are plain strings (local London values),
// matching the rest of the app; minutes is derived once and stored so daily and
// monthly totals aggregate in the database.
const router = require("express").Router();
const prisma = require("../db");
const { sTimesheet } = require("../serializers");
const { requireAuth, requireAdmin } = require("../auth");
const { notifyAdmins } = require("../notify");
const { localDate } = require("../clock");

const VALID_MODES = ["campus", "online"];
const isTime = (v) => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  (() => { const d = new Date(v + "T00:00:00Z"); return !isNaN(d) && d.toISOString().slice(0, 10) === v; })();
const isMonth = (v) => typeof v === "string" && /^\d{4}-\d{2}$/.test(v);

// Minutes between two HH:MM on the same day. Returns null if end is not after start.
const minutesBetween = (start, end) => {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const mins = (eh * 60 + em) - (sh * 60 + sm);
  return mins > 0 ? mins : null;
};

// Validate + normalise a create/update body. Returns { data } or { error }.
function parseBody(body) {
  const { date, start, end, mode, title, moduleId, note } = body || {};
  if (!isDate(date)) return { error: "date must be a valid YYYY-MM-DD" };
  if (!isTime(start)) return { error: "start must be a time in HH:MM format" };
  if (!isTime(end)) return { error: "end must be a time in HH:MM format" };
  const minutes = minutesBetween(start, end);
  if (minutes == null) return { error: "end time must be after start time" };
  if (minutes > 24 * 60) return { error: "a single entry cannot exceed 24 hours" };
  if (!VALID_MODES.includes(mode)) return { error: "mode must be 'campus' or 'online'" };
  if (typeof title !== "string" || !title.trim()) return { error: "title is required" };
  if (title.length > 200) return { error: "title is too long (200 characters maximum)" };
  if (moduleId != null && typeof moduleId !== "string") return { error: "moduleId must be a string" };
  if (note != null && typeof note !== "string") return { error: "note must be text" };
  if (typeof note === "string" && note.length > 1000) return { error: "note is too long (1000 characters maximum)" };
  return {
    data: {
      date, startTime: start, endTime: end, minutes, mode,
      title: title.trim(), moduleId: moduleId || null, note: (note || "").trim(),
    },
  };
}

// GET /api/timesheets?month=YYYY-MM&staffId=...
// Staff see only their own. Admins may pass staffId to view one person, or omit it
// to see every submitted entry (for the review screen).
router.get("/", requireAuth, async (req, res) => {
  const isAdmin = req.user.accountRole === "ADMIN";
  const where = {};
  if (req.query.month) {
    if (!isMonth(req.query.month)) return res.status(400).json({ error: "month must be YYYY-MM" });
    where.date = { startsWith: String(req.query.month) };
  }
  if (isAdmin) {
    if (req.query.staffId) where.staffId = String(req.query.staffId);
    // Admins listing everyone only care about submitted timesheets (not others' drafts).
    if (!req.query.staffId && !req.query.all) where.status = "submitted";
  } else {
    where.staffId = req.user.id; // staff: always scoped to self
  }
  const rows = await prisma.timesheetEntry.findMany({
    where,
    orderBy: [{ date: "desc" }, { startTime: "asc" }],
    ...(isAdmin ? { include: { staff: { select: { name: true, dept: true, initials: true, colour: true } } } } : {}),
  });
  res.json(rows.map(sTimesheet));
});

// POST /api/timesheets — staff adds an entry for themselves (admin may pass staffId)
router.post("/", requireAuth, async (req, res) => {
  const parsed = parseBody(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const staffId = req.user.accountRole === "ADMIN" && req.body.staffId ? String(req.body.staffId) : req.user.id;
  const exists = await prisma.staff.findUnique({ where: { id: staffId } });
  if (!exists) return res.status(400).json({ error: "Unknown staff member" });
  const rec = await prisma.timesheetEntry.create({ data: { ...parsed.data, staffId, status: "draft", createdAt: new Date() } });
  res.status(201).json(sTimesheet(rec));
});

// PUT /api/timesheets/:id — edit an entry (owner only, and only while still a draft)
router.put("/:id", requireAuth, async (req, res) => {
  const existing = await prisma.timesheetEntry.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Entry not found" });
  const isAdmin = req.user.accountRole === "ADMIN";
  if (existing.staffId !== req.user.id && !isAdmin) return res.status(403).json({ error: "Forbidden" });
  if (existing.status === "submitted" && !isAdmin) return res.status(409).json({ error: "This timesheet has already been sent and can't be edited" });
  const parsed = parseBody(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const rec = await prisma.timesheetEntry.update({ where: { id: existing.id }, data: parsed.data });
  res.json(sTimesheet(rec));
});

// DELETE /api/timesheets/:id — remove an entry (owner only, draft only)
router.delete("/:id", requireAuth, async (req, res) => {
  const existing = await prisma.timesheetEntry.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Entry not found" });
  const isAdmin = req.user.accountRole === "ADMIN";
  if (existing.staffId !== req.user.id && !isAdmin) return res.status(403).json({ error: "Forbidden" });
  if (existing.status === "submitted" && !isAdmin) return res.status(409).json({ error: "This timesheet has already been sent and can't be changed" });
  await prisma.timesheetEntry.delete({ where: { id: existing.id } });
  res.json({ ok: true });
});

// POST /api/timesheets/submit  { month: "YYYY-MM" }
// Sends a whole month: every draft entry that month becomes "submitted" and admins
// are notified. Returns the count sent + the month's total minutes.
router.post("/submit", requireAuth, async (req, res) => {
  const { month } = req.body || {};
  if (!isMonth(month)) return res.status(400).json({ error: "month must be YYYY-MM" });
  const where = { staffId: req.user.id, date: { startsWith: month }, status: "draft" };
  const drafts = await prisma.timesheetEntry.findMany({ where });
  if (drafts.length === 0) return res.status(400).json({ error: "There are no timesheet entries to send for that month" });
  await prisma.timesheetEntry.updateMany({ where, data: { status: "submitted", submittedAt: localDate() } });
  const totalMinutes = drafts.reduce((s, d) => s + d.minutes, 0);
  const hours = Math.round((totalMinutes / 60) * 10) / 10;
  notifyAdmins({ type: "info", message: `${req.user.name} sent their timesheet for ${month} — ${drafts.length} sessions, ${hours}h`, link: "timesheets" });
  res.json({ ok: true, month, sent: drafts.length, totalMinutes, hours });
});

module.exports = router;
