// HND attendance registers — modules, students, enrolments, sessions, marks.
// Reads require a signed-in user; every mutation is admin-only, matching the
// rest of the admin console.
const router = require("express").Router();
const prisma = require("../db");
const { sSemester, sProgramme, sModule, sStudent, sSession, sMark } = require("../serializers");
const { requireAuth, requireAdmin } = require("../auth");
const { isStatus, summarise } = require("../attendance");

// DEF-01: HND registers are an admin-only feature (they live entirely in the admin
// dashboard; no staff/mobile flow reads them). Guard EVERY route — reads included —
// so a non-admin token cannot read the student directory, attendance matrix or
// registers. Individual routes keep their own requireAdmin too (defence in depth).
router.use(requireAuth, requireAdmin);

const PALETTE = ["#1a3a8f", "#9e1b32", "#0d7a5f", "#b45309", "#6d28d9", "#0e7490", "#be123c"];
const colourFor = (seed) => PALETTE[Math.abs(String(seed).split("").reduce((a, c) => a + c.charCodeAt(0), 0)) % PALETTE.length];
const initialsOf = (first, last) => `${(first || "").trim()[0] || ""}${(last || "").trim()[0] || ""}`.toUpperCase() || "??";
const str = (v) => (typeof v === "string" ? v.trim() : "");
// Strict calendar validity. The previous check only proved the string PARSED —
// but V8 rolls "2039-02-30" over to 2 March rather than returning Invalid Date, so
// impossible dates were accepted. A session dated to a day that doesn't exist falls
// outside every semester range and shows different totals depending on the scope.
const { isRealDate } = require("../validate");
const isDate = (v) => isRealDate(v);
const isTime = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

// Dates are YYYY-MM-DD, so plain string comparison is date comparison.
const inRange = (date, s) => date >= s.start && date <= s.end;
const overlaps = (a, b) => a.start <= b.end && b.start <= a.end;

/* ============================== semesters ============================== */

router.get("/semesters", requireAuth, async (_req, res) => {
  const rows = await prisma.semester.findMany({ orderBy: { start: "asc" } });
  // How many sessions land in each semester, plus the ones that land in none —
  // those would otherwise be invisible in every scoped view.
  const sessions = await prisma.hndSession.findMany({ select: { date: true } });
  const out = rows.map((s) => ({ ...sSemester(s), sessionCount: sessions.filter((x) => inRange(x.date, s)).length }));
  const unassigned = sessions.filter((x) => !rows.some((s) => inRange(x.date, s))).length;
  res.json({ semesters: out, unassignedSessions: unassigned });
});

// Validate a semester's name/dates and guard against overlapping another one,
// which would make "which semester is this session in?" ambiguous.
async function validateSemester(body, excludeId) {
  const name = str(body?.name);
  const start = str(body?.start);
  const end = str(body?.end);
  if (!name) return { error: "Semester name required" };
  if (!isDate(start) || !isDate(end)) return { error: "Valid start and end dates required (YYYY-MM-DD)" };
  if (end < start) return { error: "End date must be on or after the start date" };
  const others = await prisma.semester.findMany({ where: excludeId ? { id: { not: excludeId } } : undefined });
  const clash = others.find((o) => overlaps({ start, end }, o));
  if (clash) return { error: `Those dates overlap "${clash.name}" (${clash.start} → ${clash.end})` };
  return { data: { name, start, end } };
}

router.post("/semesters", requireAuth, requireAdmin, async (req, res) => {
  const v = await validateSemester(req.body, null);
  if (v.error) return res.status(400).json({ error: v.error });
  const s = await prisma.semester.create({ data: v.data });
  res.status(201).json(sSemester(s));
});

router.put("/semesters/:id", requireAuth, requireAdmin, async (req, res) => {
  const existing = await prisma.semester.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Semester not found" });
  const v = await validateSemester({ ...existing, ...req.body }, existing.id);
  if (v.error) return res.status(400).json({ error: v.error });
  const s = await prisma.semester.update({ where: { id: existing.id }, data: v.data });
  res.json(sSemester(s));
});

// Deleting a semester never touches sessions or marks — it only changes how
// they're grouped, so the underlying registers are always safe.
router.delete("/semesters/:id", requireAuth, requireAdmin, async (req, res) => {
  try { await prisma.semester.delete({ where: { id: req.params.id } }); res.json({ ok: true }); }
  catch (_e) { res.status(404).json({ error: "Semester not found" }); }
});

/* ============================== programmes ============================== */
// A programme (e.g. "HND Business") groups the modules taught under it. Deleting
// one leaves its modules intact but unassigned (schema-level onDelete: SetNull),
// so no register is ever lost by reorganising the programme structure.

// Resolve a programmeId from the body into a value Prisma can store. Returns
// { value } on success (null clears the link) or { error } if the id is unknown.
async function resolveProgramme(raw) {
  if (raw === undefined) return { skip: true };
  const id = str(raw);
  if (!id) return { value: null };
  const exists = await prisma.programme.findUnique({ where: { id } });
  if (!exists) return { error: "Unknown programme" };
  return { value: id };
}

router.get("/programmes", requireAuth, async (_req, res) => {
  const rows = await prisma.programme.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { modules: true } } },
  });
  res.json(rows.map(sProgramme));
});

router.post("/programmes", requireAuth, requireAdmin, async (req, res) => {
  const name = str(req.body?.name);
  if (!name) return res.status(400).json({ error: "Programme name required" });
  const clash = await prisma.programme.findFirst({ where: { name: { equals: name } } });
  if (clash) return res.status(409).json({ error: `A programme called "${name}" already exists` });
  const colour = str(req.body?.colour) || colourFor(name);
  const p = await prisma.programme.create({ data: { name, colour }, include: { _count: { select: { modules: true } } } });
  res.status(201).json(sProgramme(p));
});

router.put("/programmes/:id", requireAuth, requireAdmin, async (req, res) => {
  const existing = await prisma.programme.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Programme not found" });
  const data = {};
  if (req.body?.name !== undefined) {
    const name = str(req.body.name);
    if (!name) return res.status(400).json({ error: "Programme name required" });
    const clash = await prisma.programme.findFirst({ where: { name: { equals: name }, id: { not: existing.id } } });
    if (clash) return res.status(409).json({ error: `A programme called "${name}" already exists` });
    data.name = name;
  }
  if (req.body?.colour !== undefined) data.colour = str(req.body.colour) || existing.colour;
  const p = await prisma.programme.update({ where: { id: existing.id }, data, include: { _count: { select: { modules: true } } } });
  res.json(sProgramme(p));
});

// Modules are un-assigned (not deleted) when their programme goes.
router.delete("/programmes/:id", requireAuth, requireAdmin, async (req, res) => {
  try { await prisma.programme.delete({ where: { id: req.params.id } }); res.json({ ok: true }); }
  catch (_e) { res.status(404).json({ error: "Programme not found" }); }
});

/* ============================== modules ============================== */

router.get("/modules", requireAuth, async (_req, res) => {
  // Two grouped aggregations instead of a per-module _count (which issues a
  // correlated subquery per row and collapsed at scale). Same response shape.
  const [rows, enrolAgg, sessAgg] = await Promise.all([
    prisma.hndModule.findMany({ orderBy: { code: "asc" } }),
    prisma.enrolment.groupBy({ by: ["moduleId"], _count: { _all: true } }),
    prisma.hndSession.groupBy({ by: ["moduleId"], _count: { _all: true } }),
  ]);
  const eMap = new Map(enrolAgg.map((e) => [e.moduleId, e._count._all]));
  const sMap = new Map(sessAgg.map((s) => [s.moduleId, s._count._all]));
  res.json(rows.map((m) => ({ ...sModule(m), studentCount: eMap.get(m.id) || 0, sessionCount: sMap.get(m.id) || 0 })));
});

router.post("/modules", requireAuth, requireAdmin, async (req, res) => {
  const code = str(req.body?.code).toUpperCase();
  const name = str(req.body?.name);
  if (!code) return res.status(400).json({ error: "Module code required" });
  if (!name) return res.status(400).json({ error: "Module name required" });
  const clash = await prisma.hndModule.findUnique({ where: { code } });
  if (clash) return res.status(409).json({ error: `Module code "${code}" already exists` });
  const prog = await resolveProgramme(req.body?.programmeId);
  if (prog.error) return res.status(400).json({ error: prog.error });
  const m = await prisma.hndModule.create({
    data: { code, name, tutor: str(req.body?.tutor), programmeId: prog.skip ? null : prog.value },
  });
  res.status(201).json(sModule(m));
});

router.put("/modules/:id", requireAuth, requireAdmin, async (req, res) => {
  const existing = await prisma.hndModule.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Module not found" });
  const data = {};
  if (req.body?.code !== undefined) {
    const code = str(req.body.code).toUpperCase();
    if (!code) return res.status(400).json({ error: "Module code required" });
    const clash = await prisma.hndModule.findUnique({ where: { code } });
    if (clash && clash.id !== existing.id) return res.status(409).json({ error: `Module code "${code}" already exists` });
    data.code = code;
  }
  if (req.body?.name !== undefined) {
    const name = str(req.body.name);
    if (!name) return res.status(400).json({ error: "Module name required" });
    data.name = name;
  }
  if (req.body?.tutor !== undefined) data.tutor = str(req.body.tutor);
  const prog = await resolveProgramme(req.body?.programmeId);
  if (prog.error) return res.status(400).json({ error: prog.error });
  if (!prog.skip) data.programmeId = prog.value;
  const m = await prisma.hndModule.update({ where: { id: existing.id }, data });
  res.json(sModule(m));
});

// Deleting a module cascades to its sessions, marks and enrolments (schema-level).
router.delete("/modules/:id", requireAuth, requireAdmin, async (req, res) => {
  try { await prisma.hndModule.delete({ where: { id: req.params.id } }); res.json({ ok: true }); }
  catch (_e) { res.status(404).json({ error: "Module not found" }); }
});

// Set which students are enrolled on a module — the module-side mirror of
// PUT /students/:id/enrolments. Replaces the whole set; un-enrolling a student
// deliberately KEEPS any marks they already have, so past registers still read
// as they were taken.
router.put("/modules/:id/enrolments", requireAuth, requireAdmin, async (req, res) => {
  const mod = await prisma.hndModule.findUnique({ where: { id: req.params.id } });
  if (!mod) return res.status(404).json({ error: "Module not found" });
  if (!Array.isArray(req.body?.studentIds)) return res.status(400).json({ error: "studentIds must be an array of student ids" });
  if (req.body.studentIds.some((x) => typeof x !== "string")) return res.status(400).json({ error: "studentIds must contain only student ids" });
  const studentIds = [...new Set(req.body.studentIds)];
  if (studentIds.length) {
    const found = await prisma.student.count({ where: { id: { in: studentIds } } });
    if (found !== studentIds.length) return res.status(400).json({ error: "One or more students do not exist" });
  }
  await prisma.$transaction([
    prisma.enrolment.deleteMany({ where: { moduleId: mod.id, studentId: { notIn: studentIds.length ? studentIds : ["__none__"] } } }),
    ...studentIds.map((studentId) => prisma.enrolment.upsert({
      where: { studentId_moduleId: { studentId, moduleId: mod.id } },
      create: { studentId, moduleId: mod.id },
      update: {},
    })),
  ]);
  const m = await prisma.hndModule.findUnique({ where: { id: mod.id }, include: { _count: { select: { sessions: true, enrolments: true } } } });
  res.json(sModule(m));
});

/* ============================== students ============================== */

router.get("/students", requireAuth, async (_req, res) => {
  const rows = await prisma.student.findMany({
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    include: { enrolments: { select: { moduleId: true } } },
  });
  res.json(rows.map(sStudent));
});

router.post("/students", requireAuth, requireAdmin, async (req, res) => {
  const firstName = str(req.body?.firstName);
  const lastName = str(req.body?.lastName);
  const studentRef = str(req.body?.studentRef);
  if (!firstName || !lastName) return res.status(400).json({ error: "First and last name required" });
  if (!studentRef) return res.status(400).json({ error: "Student number required" });
  // Lower-case BOTH branches. The generated address previously kept whatever case
  // the student number had, so "HND123@..." and a later hand-typed "hnd123@..."
  // both passed the exact-match uniqueness check and two students shared a mailbox.
  const email = (str(req.body?.email) || `${studentRef}@londonbrookescollege.co.uk`).toLowerCase();

  const refClash = await prisma.student.findUnique({ where: { studentRef } });
  if (refClash) return res.status(409).json({ error: `Student number ${studentRef} is already in use` });
  const emailClash = await prisma.student.findUnique({ where: { email } });
  if (emailClash) return res.status(409).json({ error: `Email ${email} is already in use` });

  // Validate enrolments up front so a bad moduleId can't blow up the nested create.
  const moduleIds = Array.isArray(req.body?.moduleIds) ? [...new Set(req.body.moduleIds.filter((x) => typeof x === "string"))] : [];
  if (moduleIds.length) {
    const found = await prisma.hndModule.count({ where: { id: { in: moduleIds } } });
    if (found !== moduleIds.length) return res.status(400).json({ error: "One or more modules do not exist" });
  }

  const s = await prisma.student.create({
    data: {
      firstName, lastName, studentRef, email,
      initials: initialsOf(firstName, lastName),
      colour: colourFor(studentRef + lastName),
      enrolments: { create: moduleIds.map((moduleId) => ({ moduleId })) },
    },
    include: { enrolments: { select: { moduleId: true } } },
  });
  res.status(201).json(sStudent(s));
});

router.put("/students/:id", requireAuth, requireAdmin, async (req, res) => {
  const existing = await prisma.student.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Student not found" });

  const data = {};
  if (req.body?.firstName !== undefined) {
    const firstName = str(req.body.firstName);
    if (!firstName) return res.status(400).json({ error: "First name required" });
    data.firstName = firstName;
  }
  if (req.body?.lastName !== undefined) {
    const lastName = str(req.body.lastName);
    if (!lastName) return res.status(400).json({ error: "Last name required" });
    data.lastName = lastName;
  }
  if (data.firstName || data.lastName) {
    data.initials = initialsOf(data.firstName || existing.firstName, data.lastName || existing.lastName);
  }
  if (req.body?.studentRef !== undefined) {
    const studentRef = str(req.body.studentRef);
    if (!studentRef) return res.status(400).json({ error: "Student number required" });
    const clash = await prisma.student.findUnique({ where: { studentRef } });
    if (clash && clash.id !== existing.id) return res.status(409).json({ error: `Student number ${studentRef} is already in use` });
    data.studentRef = studentRef;
  }
  if (req.body?.email !== undefined) {
    const email = str(req.body.email).toLowerCase();
    if (!email) return res.status(400).json({ error: "Email required" });
    const clash = await prisma.student.findUnique({ where: { email } });
    if (clash && clash.id !== existing.id) return res.status(409).json({ error: `Email ${email} is already in use` });
    data.email = email;
  }
  if (typeof req.body?.active === "boolean") data.active = req.body.active;

  const s = await prisma.student.update({
    where: { id: existing.id }, data,
    include: { enrolments: { select: { moduleId: true } } },
  });
  res.json(sStudent(s));
});

router.delete("/students/:id", requireAuth, requireAdmin, async (req, res) => {
  try { await prisma.student.delete({ where: { id: req.params.id } }); res.json({ ok: true }); }
  catch (_e) { res.status(404).json({ error: "Student not found" }); }
});

// Replace a student's module enrolments wholesale.
// Un-enrolling drops the student from future registers but deliberately KEEPS
// their existing marks, so past registers still read as they were taken.
router.put("/students/:id/enrolments", requireAuth, requireAdmin, async (req, res) => {
  const student = await prisma.student.findUnique({ where: { id: req.params.id } });
  if (!student) return res.status(404).json({ error: "Student not found" });
  // This is the one call that can wipe a student's whole enrolment set, so malformed
  // input must NOT be read as "clear everything". Sending a string, or omitting the
  // field, previously dropped the student off every register with a cheerful 200.
  if (!Array.isArray(req.body?.moduleIds)) return res.status(400).json({ error: "moduleIds must be an array of module ids" });
  if (req.body.moduleIds.some((x) => typeof x !== "string")) return res.status(400).json({ error: "moduleIds must contain only module ids" });
  const moduleIds = [...new Set(req.body.moduleIds)];
  if (moduleIds.length) {
    const found = await prisma.hndModule.count({ where: { id: { in: moduleIds } } });
    if (found !== moduleIds.length) return res.status(400).json({ error: "One or more modules do not exist" });
  }
  await prisma.$transaction([
    prisma.enrolment.deleteMany({ where: { studentId: student.id, moduleId: { notIn: moduleIds.length ? moduleIds : ["__none__"] } } }),
    ...moduleIds.map((moduleId) => prisma.enrolment.upsert({
      where: { studentId_moduleId: { studentId: student.id, moduleId } },
      create: { studentId: student.id, moduleId },
      update: {},
    })),
  ]);
  const s = await prisma.student.findUnique({ where: { id: student.id }, include: { enrolments: { select: { moduleId: true } } } });
  res.json(sStudent(s));
});

/* ============================== sessions ============================== */

router.get("/sessions", requireAuth, async (req, res) => {
  const moduleId = str(req.query?.moduleId);
  const [rows, agg] = await Promise.all([
    prisma.hndSession.findMany({ where: moduleId ? { moduleId } : undefined, orderBy: [{ date: "desc" }, { startTime: "asc" }] }),
    prisma.attendanceMark.groupBy({ by: ["sessionId"], _count: { _all: true }, where: moduleId ? { session: { moduleId } } : undefined }),
  ]);
  const cMap = new Map(agg.map((a) => [a.sessionId, a._count._all]));
  res.json(rows.map((s) => ({ ...sSession(s), markedCount: cMap.get(s.id) || 0 })));
});

router.post("/sessions", requireAuth, requireAdmin, async (req, res) => {
  const moduleId = str(req.body?.moduleId);
  const date = str(req.body?.date);
  const start = str(req.body?.start);
  const end = str(req.body?.end);
  if (!moduleId) return res.status(400).json({ error: "Module required" });
  const mod = await prisma.hndModule.findUnique({ where: { id: moduleId } });
  if (!mod) return res.status(400).json({ error: "Unknown module" });
  if (!isDate(date)) return res.status(400).json({ error: "Valid date required (YYYY-MM-DD)" });
  if (!isTime(start) || !isTime(end)) return res.status(400).json({ error: "Valid start and end times required (HH:MM)" });
  if (end <= start) return res.status(400).json({ error: "End time must be after the start time" });

  const s = await prisma.hndSession.create({
    data: {
      moduleId, date, startTime: start, endTime: end,
      description: str(req.body?.description) || mod.code,
      audience: str(req.body?.audience) || "All students",
    },
  });
  res.status(201).json(sSession(s));
});

router.put("/sessions/:id", requireAuth, requireAdmin, async (req, res) => {
  const existing = await prisma.hndSession.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Session not found" });
  const data = {};
  if (req.body?.date !== undefined) {
    if (!isDate(str(req.body.date))) return res.status(400).json({ error: "Valid date required (YYYY-MM-DD)" });
    data.date = str(req.body.date);
  }
  if (req.body?.start !== undefined) {
    if (!isTime(str(req.body.start))) return res.status(400).json({ error: "Valid start time required (HH:MM)" });
    data.startTime = str(req.body.start);
  }
  if (req.body?.end !== undefined) {
    if (!isTime(str(req.body.end))) return res.status(400).json({ error: "Valid end time required (HH:MM)" });
    data.endTime = str(req.body.end);
  }
  const start = data.startTime || existing.startTime;
  const end = data.endTime || existing.endTime;
  if (end <= start) return res.status(400).json({ error: "End time must be after the start time" });
  if (req.body?.description !== undefined) data.description = str(req.body.description);
  if (req.body?.audience !== undefined) data.audience = str(req.body.audience) || "All students";
  const s = await prisma.hndSession.update({ where: { id: existing.id }, data });
  res.json(sSession(s));
});

router.delete("/sessions/:id", requireAuth, requireAdmin, async (req, res) => {
  try { await prisma.hndSession.delete({ where: { id: req.params.id } }); res.json({ ok: true }); }
  catch (_e) { res.status(404).json({ error: "Session not found" }); }
});

// Generate one weekly session for a module across a date range — the same weekday
// as the start date, every 7 days up to and including the end date. Used when a
// course is created with a term start/end so its whole register schedule appears
// at once. Idempotent: dates that already have a session for this module are
// skipped, so re-running never duplicates.
const MAX_WEEKLY_SESSIONS = 60; // ~14 months of weeks — a safety cap, not a limit anyone hits
router.post("/modules/:id/sessions/generate", requireAuth, requireAdmin, async (req, res) => {
  const mod = await prisma.hndModule.findUnique({ where: { id: req.params.id } });
  if (!mod) return res.status(404).json({ error: "Module not found" });

  const start = str(req.body?.start);
  const end = str(req.body?.end);
  const startTime = str(req.body?.startTime) || "10:00";
  const endTime = str(req.body?.endTime) || "13:00";
  const audience = str(req.body?.audience) || "All students";
  if (!isDate(start) || !isDate(end)) return res.status(400).json({ error: "Valid start and end dates required (YYYY-MM-DD)" });
  if (end < start) return res.status(400).json({ error: "End date must be on or after the start date" });
  if (!isTime(startTime) || !isTime(endTime)) return res.status(400).json({ error: "Valid start and end times required (HH:MM)" });
  if (endTime <= startTime) return res.status(400).json({ error: "End time must be after the start time" });

  // Step weekly in UTC so a timezone can't nudge a date across midnight.
  const dates = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cursor <= last && dates.length < MAX_WEEKLY_SESSIONS) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }

  const existing = await prisma.hndSession.findMany({ where: { moduleId: mod.id, date: { in: dates } }, select: { date: true } });
  const have = new Set(existing.map((x) => x.date));
  const toCreate = dates.filter((d) => !have.has(d));
  if (toCreate.length) {
    await prisma.hndSession.createMany({
      data: toCreate.map((date) => ({ moduleId: mod.id, date, startTime, endTime, description: mod.code, audience })),
    });
  }
  res.status(201).json({ ok: true, weeks: dates.length, created: toCreate.length, skipped: dates.length - toCreate.length });
});

/* ============================== the register ============================== */

// GET the register for one session: every enrolled student, with their existing
// mark if the register has already been taken.
router.get("/sessions/:id/register", requireAuth, async (req, res) => {
  const session = await prisma.hndSession.findUnique({
    where: { id: req.params.id },
    include: { module: true, marks: true },
  });
  if (!session) return res.status(404).json({ error: "Session not found" });

  const enrolments = await prisma.enrolment.findMany({
    where: { moduleId: session.moduleId },
    include: { student: true },
  });
  const byStudent = new Map(session.marks.map((m) => [m.studentId, m]));

  // A student who has since been un-enrolled but was marked on this session
  // still belongs on the register — otherwise their mark would silently vanish.
  const extra = session.marks
    .filter((m) => !enrolments.some((e) => e.studentId === m.studentId))
    .map((m) => m.studentId);
  const extraStudents = extra.length ? await prisma.student.findMany({ where: { id: { in: extra } } }) : [];

  const students = [...enrolments.map((e) => e.student), ...extraStudents]
    .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));

  res.json({
    session: sSession(session),
    module: sModule(session.module),
    rows: students.map((s) => {
      const mark = byStudent.get(s.id);
      return {
        student: sStudent(s),
        status: mark?.status || null,
        remark: mark?.remark || "",
        takenBy: mark?.takenBy || null,
        enrolled: enrolments.some((e) => e.studentId === s.id),
      };
    }),
    taken: session.marks.length > 0,
  });
});

// Save the register. Accepts a partial list — only the students present in the
// body are written, so a half-finished register can be saved and resumed.
// A row with status null/"" clears that student's mark.
router.put("/sessions/:id/register", requireAuth, requireAdmin, async (req, res) => {
  const session = await prisma.hndSession.findUnique({ where: { id: req.params.id } });
  if (!session) return res.status(404).json({ error: "Session not found" });

  const marks = Array.isArray(req.body?.marks) ? req.body.marks : null;
  if (!marks) return res.status(400).json({ error: "marks array required" });

  const rows = [];
  for (const m of marks) {
    const studentId = str(m?.studentId);
    if (!studentId) return res.status(400).json({ error: "Each mark needs a studentId" });
    const status = m?.status == null || m.status === "" ? null : str(m.status).toUpperCase();
    if (status !== null && !isStatus(status)) return res.status(400).json({ error: `Invalid status "${m.status}" — use P, L, E or A` });
    const remark = typeof m?.remark === "string" ? m.remark.slice(0, 500) : "";
    rows.push({ studentId, status, remark });
  }

  const ids = rows.map((r) => r.studentId);
  if (ids.length) {
    const found = await prisma.student.count({ where: { id: { in: ids } } });
    if (found !== new Set(ids).size) return res.status(400).json({ error: "One or more students do not exist" });
  }

  const takenBy = req.user?.name || null;
  await prisma.$transaction(rows.map((r) => (
    r.status === null
      ? prisma.attendanceMark.deleteMany({ where: { sessionId: session.id, studentId: r.studentId } })
      : prisma.attendanceMark.upsert({
          where: { sessionId_studentId: { sessionId: session.id, studentId: r.studentId } },
          create: { sessionId: session.id, studentId: r.studentId, status: r.status, remark: r.remark, takenBy },
          update: { status: r.status, remark: r.remark, takenBy, takenAt: new Date() },
        })
  )));

  const saved = await prisma.attendanceMark.findMany({ where: { sessionId: session.id } });
  res.json({ ok: true, saved: saved.length, marks: saved.map(sMark) });
});

/* ============================== percentages ============================== */

// The attendance matrix: every student's percentage per module, their overall
// percentage across all modules, and the cohort figures per module + overall.
//
// ?semesterId=<id>       -> only sessions dated inside that semester
// ?semesterId=unassigned -> only sessions outside every semester
// (omitted)              -> every session on record
router.get("/attendance", requireAuth, async (req, res) => {
  const semesterId = str(req.query?.semesterId);
  const semesters = await prisma.semester.findMany({ orderBy: { start: "asc" } });

  let scope = null; // null = everything
  if (semesterId === "unassigned") {
    scope = (date) => !semesters.some((s) => inRange(date, s));
  } else if (semesterId) {
    const sem = semesters.find((s) => s.id === semesterId);
    if (!sem) return res.status(404).json({ error: "Semester not found" });
    scope = (date) => inRange(date, sem);
  }

  const [modules, students, allMarks, allSessions, enrolAgg] = await Promise.all([
    prisma.hndModule.findMany({ orderBy: { code: "asc" } }),
    prisma.student.findMany({
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      include: { enrolments: { select: { moduleId: true } } },
    }),
    // Only the three columns the matrix needs; resolve module/date from an
    // in-memory session lookup rather than a per-row join.
    prisma.attendanceMark.findMany({ select: { studentId: true, status: true, sessionId: true } }),
    prisma.hndSession.findMany({ select: { id: true, moduleId: true, date: true } }),
    prisma.enrolment.groupBy({ by: ["moduleId"], _count: { _all: true } }),
  ]);

  const sessById = new Map(allSessions.map((s) => [s.id, s]));
  for (const m of allMarks) { const se = sessById.get(m.sessionId); m.moduleId = se ? se.moduleId : null; m.date = se ? se.date : null; }

  const marks = scope ? allMarks.filter((m) => scope(m.date)) : allMarks;
  const sessions = scope ? allSessions.filter((s) => scope(s.date)) : allSessions;

  // Single pass: group marks by student→module AND by module (cohort totals),
  // instead of re-filtering the whole mark set per module.
  const index = new Map();          // studentId -> Map(moduleId -> marks[])
  const marksByModule = new Map();  // moduleId  -> marks[]
  for (const m of marks) {
    if (!index.has(m.studentId)) index.set(m.studentId, new Map());
    const per = index.get(m.studentId);
    if (!per.has(m.moduleId)) per.set(m.moduleId, []);
    per.get(m.moduleId).push(m);
    if (!marksByModule.has(m.moduleId)) marksByModule.set(m.moduleId, []);
    marksByModule.get(m.moduleId).push(m);
  }

  // Per student, iterate only the modules they're enrolled on or have marks for
  // — not every module in the college (was O(students × all modules)).
  const rows = students.map((s) => {
    const per = index.get(s.id) || new Map();
    const enrolledIds = new Set(s.enrolments.map((e) => e.moduleId));
    const relevant = new Set([...enrolledIds, ...per.keys()]);
    const modulesOut = {};
    for (const modId of relevant) {
      modulesOut[modId] = { ...summarise(per.get(modId) || []), enrolled: enrolledIds.has(modId) };
    }
    const all = [...per.values()].flat();
    return { student: sStudent(s), modules: modulesOut, overall: summarise(all) };
  });

  // Session counts per module: scoped (for moduleTotals) and all-time (module shape).
  const scopedSess = new Map(), allSess = new Map();
  for (const se of sessions) scopedSess.set(se.moduleId, (scopedSess.get(se.moduleId) || 0) + 1);
  for (const se of allSessions) allSess.set(se.moduleId, (allSess.get(se.moduleId) || 0) + 1);
  const enrolCount = new Map(enrolAgg.map((e) => [e.moduleId, e._count._all]));

  const moduleTotals = {};
  for (const mod of modules) {
    moduleTotals[mod.id] = { ...summarise(marksByModule.get(mod.id) || []), sessionCount: scopedSess.get(mod.id) || 0 };
  }

  res.json({
    modules: modules.map((m) => ({ ...sModule(m), studentCount: enrolCount.get(m.id) || 0, sessionCount: allSess.get(m.id) || 0 })),
    rows,
    moduleTotals,
    overall: summarise(marks),
    scope: { semesterId: semesterId || "", sessionCount: sessions.length },
  });
});

module.exports = router;
