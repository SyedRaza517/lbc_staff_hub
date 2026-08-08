// Weekly timetables — the schedule a student reads on their app, managed by admins.
//
// A timetable is a set of TimetableSlot rows scoped to a course + year + term. Rows are
// auto-filled from a unit's generated sessions (which supply the weekday and times),
// then edited; extra rows (workshops, study support) are added by hand. See the model
// comment in schema.prisma.
//
// Gated on its own "timetable" admin page, like every other section — reads and writes
// both, since the whole feature is admin-only (students read via /api/student/me/timetable).
const router = require("express").Router();
const prisma = require("../db");
const { sTimetableSlot } = require("../serializers");
const { requireAuth, requirePage } = require("../auth");

router.use(requireAuth, requirePage("timetable"));

const str = (v) => (typeof v === "string" ? v.trim() : "");
const isTime = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const isDay = (v) => Number.isInteger(v) && v >= 1 && v <= 7;
const MAX_YEAR = 2, MAX_TERM = 6;

// Validate a slot body for create/update. `partial` allows omitted fields on update.
function parseSlot(body, partial) {
  const data = {};
  const need = (k) => !partial || body?.[k] !== undefined;
  if (need("day")) {
    const day = Number(body?.day);
    if (!isDay(day)) return { error: "day must be 1 (Monday) to 7 (Sunday)" };
    data.day = day;
  }
  if (need("start")) { const s = str(body?.start); if (!isTime(s)) return { error: "start must be HH:MM" }; data.startTime = s; }
  if (need("end")) { const e = str(body?.end); if (!isTime(e)) return { error: "end must be HH:MM" }; data.endTime = e; }
  const start = data.startTime ?? undefined, end = data.endTime ?? undefined;
  if (start && end && end <= start) return { error: "end time must be after the start time" };
  if (need("title")) { const t = str(body?.title); if (!t) return { error: "A session title is required" }; data.title = t.slice(0, 200); }
  if (body?.lecturer !== undefined) data.lecturer = str(body.lecturer).slice(0, 120);
  if (body?.room !== undefined) data.room = str(body.room).slice(0, 120);
  return { data };
}

// Resolve and validate the course/year/term scope from a body.
async function parseScope(body) {
  const courseId = str(body?.courseId);
  if (!courseId) return { error: "A course is required" };
  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) return { error: "Unknown course" };
  const year = body?.year == null || body.year === "" ? null : Number(body.year);
  const termNumber = body?.termNumber == null || body.termNumber === "" ? null : Number(body.termNumber);
  if (year != null && (!Number.isInteger(year) || year < 1 || year > MAX_YEAR)) return { error: `year must be 1 to ${MAX_YEAR}` };
  if (termNumber != null && (!Number.isInteger(termNumber) || termNumber < 1 || termNumber > MAX_TERM)) return { error: `term must be 1 to ${MAX_TERM}` };
  return { courseId, year, termNumber };
}

// GET /api/timetable/courses — courses that have units, for the picker, each with the
// (year, term) placements its units cover, so the admin can jump straight to a stage.
router.get("/courses", async (_req, res) => {
  const courses = await prisma.course.findMany({ orderBy: { name: "asc" }, include: { units: { select: { year: true, termNumber: true } } } });
  res.json(courses.map((c) => {
    const stages = [...new Set(c.units.filter((u) => u.year != null && u.termNumber != null).map((u) => `${u.year}|${u.termNumber}`))]
      .map((k) => { const [y, t] = k.split("|"); return { year: Number(y), termNumber: Number(t) }; })
      .sort((a, b) => a.year - b.year || a.termNumber - b.termNumber);
    return { id: c.id, name: c.name, colour: c.colour, stages };
  }));
});

// GET /api/timetable?courseId=&year=&termNumber= — the slots in one scope, plus the
// units in that scope (so the admin can see which units have no timetable rows yet).
router.get("/", async (req, res) => {
  const courseId = str(req.query?.courseId);
  if (!courseId) return res.status(400).json({ error: "courseId is required" });
  const year = req.query?.year != null && req.query.year !== "" ? Number(req.query.year) : null;
  const termNumber = req.query?.termNumber != null && req.query.termNumber !== "" ? Number(req.query.termNumber) : null;
  const where = { courseId, year, termNumber };
  const [slots, units] = await Promise.all([
    prisma.timetableSlot.findMany({ where, include: { unit: { select: { code: true } } }, orderBy: [{ day: "asc" }, { startTime: "asc" }] }),
    prisma.unit.findMany({
      where: { courseId, ...(year != null ? { year } : {}), ...(termNumber != null ? { termNumber } : {}) },
      select: { id: true, code: true, name: true, tutor: true, tutorStaff: { select: { name: true } }, _count: { select: { sessions: true, timetableSlots: true } } },
      orderBy: { code: "asc" },
    }),
  ]);
  res.json({
    slots: slots.map(sTimetableSlot),
    units: units.map((u) => ({ id: u.id, code: u.code, name: u.name, tutor: u.tutorStaff?.name || u.tutor || "", sessionCount: u._count.sessions, slotCount: u._count.timetableSlots })),
  });
});

// POST /api/timetable/autofill  { courseId, year, termNumber }
// Build slots for every unit in the scope, from that unit's generated sessions. Each
// distinct (weekday, start, end, kind) becomes a slot: a "Teaching" session is the
// class, a "Seminar" becomes a "… Tutorial" row — matching how the college lays it out.
// Idempotent: a unit that already has slots is skipped, so re-running never duplicates.
const isoDay = (dateStr) => { const d = new Date(`${dateStr}T00:00:00Z`).getUTCDay(); return d === 0 ? 7 : d; }; // Sun=0 -> 7
router.post("/autofill", async (req, res) => {
  const scope = await parseScope(req.body);
  if (scope.error) return res.status(400).json({ error: scope.error });
  const { courseId, year, termNumber } = scope;

  const units = await prisma.unit.findMany({
    where: { courseId, ...(year != null ? { year } : {}), ...(termNumber != null ? { termNumber } : {}) },
    include: { sessions: { select: { date: true, startTime: true, endTime: true, kind: true } }, tutorStaff: { select: { name: true } }, _count: { select: { timetableSlots: true } } },
  });

  const toCreate = [];
  const skipped = [];
  for (const u of units) {
    if (u._count.timetableSlots > 0) { skipped.push({ code: u.code, reason: "already has timetable rows" }); continue; }
    if (!u.sessions.length) { skipped.push({ code: u.code, reason: "no registers to read a day/time from" }); continue; }
    const lecturer = u.tutorStaff?.name || u.tutor || "";
    const seen = new Set();
    for (const s of u.sessions) {
      const day = isoDay(s.date);
      const key = `${day}|${s.startTime}|${s.endTime}|${s.kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const isTutorial = String(s.kind || "").toLowerCase() === "seminar";
      toCreate.push({
        courseId, year, termNumber, unitId: u.id,
        day, startTime: s.startTime, endTime: s.endTime,
        title: `${u.name}${isTutorial ? " Tutorial" : ""}`,
        lecturer, room: "",
      });
    }
  }
  if (toCreate.length) await prisma.timetableSlot.createMany({ data: toCreate });
  res.status(201).json({ created: toCreate.length, unitsFilled: units.length - skipped.length, skipped });
});

// POST /api/timetable/slots — add one row by hand (a workshop, study support, or a
// correction). courseId/year/termNumber set the scope; unitId is optional.
router.post("/slots", async (req, res) => {
  const scope = await parseScope(req.body);
  if (scope.error) return res.status(400).json({ error: scope.error });
  const parsed = parseSlot(req.body, false);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  let unitId = str(req.body?.unitId) || null;
  if (unitId && !(await prisma.unit.findUnique({ where: { id: unitId } }))) unitId = null;
  const slot = await prisma.timetableSlot.create({
    data: { courseId: scope.courseId, year: scope.year, termNumber: scope.termNumber, unitId, ...parsed.data },
    include: { unit: { select: { code: true } } },
  });
  res.status(201).json(sTimetableSlot(slot));
});

// PUT /api/timetable/slots/:id — edit a row's day/time/title/lecturer/room.
router.put("/slots/:id", async (req, res) => {
  const existing = await prisma.timetableSlot.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Timetable row not found" });
  const parsed = parseSlot(req.body, true);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  // Cross-field time check when only one side is being changed.
  const start = parsed.data.startTime ?? existing.startTime, end = parsed.data.endTime ?? existing.endTime;
  if (end <= start) return res.status(400).json({ error: "end time must be after the start time" });
  const slot = await prisma.timetableSlot.update({ where: { id: existing.id }, data: parsed.data, include: { unit: { select: { code: true } } } });
  res.json(sTimetableSlot(slot));
});

// DELETE /api/timetable/slots/:id
router.delete("/slots/:id", async (req, res) => {
  try { await prisma.timetableSlot.delete({ where: { id: req.params.id } }); res.json({ ok: true }); }
  catch (_e) { res.status(404).json({ error: "Timetable row not found" }); }
});

module.exports = router;
