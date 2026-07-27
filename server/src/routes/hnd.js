// HND attendance registers — modules, students, enrolments, sessions, marks.
// Reads require a signed-in user; every mutation is admin-only, matching the
// rest of the admin console.
const router = require("express").Router();
const prisma = require("../db");
const { sSemester, sProgramme, sCohort, sTerm, sModule, sStudent, sSession, sMark } = require("../serializers");
const { requireAuth, requireAdmin, requireAnyPage } = require("../auth");
const { isStatus, summarise } = require("../attendance");

// DEF-01: HND registers are an admin-only feature (they live entirely in the admin
// dashboard; no staff/mobile flow reads them). Guard EVERY route — reads included —
// so a non-admin token cannot read the student directory, attendance matrix or
// registers. Individual routes keep their own requireAdmin too (defence in depth).
router.use(requireAuth, requireAnyPage(["registers", "students"]));

const PALETTE = ["#1a3a8f", "#9e1b32", "#0d7a5f", "#b45309", "#6d28d9", "#0e7490", "#be123c"];
const colourFor = (seed) => PALETTE[Math.abs(String(seed).split("").reduce((a, c) => a + c.charCodeAt(0), 0)) % PALETTE.length];
const initialsOf = (first, last) => `${(first || "").trim()[0] || ""}${(last || "").trim()[0] || ""}`.toUpperCase() || "??";
const str = (v) => (typeof v === "string" ? v.trim() : "");
// Strict calendar validity. The previous check only proved the string PARSED —
// but V8 rolls "2039-02-30" over to 2 March rather than returning Invalid Date, so
// impossible dates were accepted. A session dated to a day that doesn't exist falls
// outside every semester range and shows different totals depending on the scope.
const { isRealDate } = require("../validate");
const { localDate } = require("../clock");
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

// Resolve a unit's cohort + term, ensuring the term (if any) belongs to the cohort.
// Either may be null. A term given without a cohort derives the cohort from it.
async function resolveCohortTerm(rawCohort, rawTerm) {
  const cohortId = str(rawCohort) || null;
  const termId = str(rawTerm) || null;
  if (cohortId && !(await prisma.cohort.findUnique({ where: { id: cohortId } }))) return { error: "Unknown cohort" };
  if (termId) {
    const t = await prisma.term.findUnique({ where: { id: termId } });
    if (!t) return { error: "Unknown term" };
    if (cohortId && t.cohortId !== cohortId) return { error: "That term isn't in the chosen cohort" };
    return { cohortId: cohortId || t.cohortId, termId };
  }
  return { cohortId, termId: null };
}

router.get("/programmes", requireAuth, async (_req, res) => {
  const rows = await prisma.programme.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { modules: true, cohorts: true } } },
  });
  res.json(rows.map(sProgramme));
});

router.post("/programmes", requireAuth, requireAdmin, async (req, res) => {
  const name = str(req.body?.name);
  if (!name) return res.status(400).json({ error: "Programme name required" });
  const clash = await prisma.programme.findFirst({ where: { name: { equals: name } } });
  if (clash) return res.status(409).json({ error: `A programme called "${name}" already exists` });
  const colour = str(req.body?.colour) || colourFor(name);
  const p = await prisma.programme.create({ data: { name, colour }, include: { _count: { select: { modules: true, cohorts: true } } } });
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
  const p = await prisma.programme.update({ where: { id: existing.id }, data, include: { _count: { select: { modules: true, cohorts: true } } } });
  res.json(sProgramme(p));
});

// Modules are un-assigned (not deleted) when their programme goes.
router.delete("/programmes/:id", requireAuth, requireAdmin, async (req, res) => {
  try { await prisma.programme.delete({ where: { id: req.params.id } }); res.json({ ok: true }); }
  catch (_e) { res.status(404).json({ error: "Programme not found" }); }
});

/* ============================== cohorts ============================== */
// An intake of students on a programme, e.g. "SEP 2025". One programme runs many
// cohorts over time; each name is unique within its programme.

router.get("/cohorts", requireAuth, async (req, res) => {
  const programmeId = str(req.query?.programmeId);
  const where = programmeId ? { programmeId } : {};
  const rows = await prisma.cohort.findMany({ where, orderBy: [{ programmeId: "asc" }, { createdAt: "asc" }] });
  res.json(rows.map(sCohort));
});

router.post("/cohorts", requireAuth, requireAdmin, async (req, res) => {
  const name = str(req.body?.name);
  const programmeId = str(req.body?.programmeId);
  const startDate = str(req.body?.startDate) || null;
  if (!name) return res.status(400).json({ error: "Cohort name required" });
  if (!programmeId) return res.status(400).json({ error: "Programme is required" });
  if (startDate && !isDate(startDate)) return res.status(400).json({ error: "Start date must be a valid date (YYYY-MM-DD)" });
  const prog = await prisma.programme.findUnique({ where: { id: programmeId } });
  if (!prog) return res.status(400).json({ error: "Unknown programme" });
  const clash = await prisma.cohort.findFirst({ where: { programmeId, name } });
  if (clash) return res.status(409).json({ error: `"${name}" already exists on this programme` });
  try {
    const c = await prisma.cohort.create({ data: { name, programmeId, startDate } });
    res.status(201).json(sCohort(c));
  } catch (_e) { res.status(400).json({ error: "Could not create the cohort" }); }
});

router.put("/cohorts/:id", requireAuth, requireAdmin, async (req, res) => {
  const existing = await prisma.cohort.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Cohort not found" });
  const data = {};
  if (req.body?.name !== undefined) {
    const name = str(req.body.name);
    if (!name) return res.status(400).json({ error: "Cohort name required" });
    const clash = await prisma.cohort.findFirst({ where: { programmeId: existing.programmeId, name, id: { not: existing.id } } });
    if (clash) return res.status(409).json({ error: `"${name}" already exists on this programme` });
    data.name = name;
  }
  if (req.body?.startDate !== undefined) {
    const sd = str(req.body.startDate) || null;
    if (sd && !isDate(sd)) return res.status(400).json({ error: "Start date must be a valid date (YYYY-MM-DD)" });
    data.startDate = sd;
  }
  const c = await prisma.cohort.update({ where: { id: existing.id }, data });
  res.json(sCohort(c));
});

router.delete("/cohorts/:id", requireAuth, requireAdmin, async (req, res) => {
  try { await prisma.cohort.delete({ where: { id: req.params.id } }); res.json({ ok: true }); }
  catch (_e) { res.status(404).json({ error: "Cohort not found" }); }
});

/* ============================== terms ============================== */
// Each cohort runs 6 terms (Year 1 T1-3, Year 2 T1-3). Dates drive which term is
// "active" (contains today) — that's what opens/pauses attendance later.

// Add whole days to a YYYY-MM-DD string, UTC-safe.
const addDays = (iso, days) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

router.get("/terms", requireAuth, async (req, res) => {
  const cohortId = str(req.query?.cohortId);
  const where = cohortId ? { cohortId } : {};
  const rows = await prisma.term.findMany({ where, orderBy: [{ cohortId: "asc" }, { year: "asc" }, { index: "asc" }] });
  res.json(rows.map(sTerm));
});

// Generate the standard 6 terms for a cohort, back-to-back from a start date.
// Body: { start?, weeksPerTerm? } — start defaults to the cohort's own start date.
router.post("/cohorts/:id/terms/generate", requireAuth, requireAdmin, async (req, res) => {
  const cohort = await prisma.cohort.findUnique({ where: { id: req.params.id } });
  if (!cohort) return res.status(404).json({ error: "Cohort not found" });
  const start = str(req.body?.start) || cohort.startDate;
  if (!start || !isDate(start)) return res.status(400).json({ error: "A valid start date is needed — set the cohort's start date or pass one" });
  const weeks = Number.isInteger(req.body?.weeksPerTerm) && req.body.weeksPerTerm > 0 && req.body.weeksPerTerm <= 52 ? req.body.weeksPerTerm : 14;
  if (await prisma.term.count({ where: { cohortId: cohort.id } }) > 0) {
    return res.status(409).json({ error: "This cohort already has terms — edit or delete them first" });
  }
  const len = weeks * 7;
  const data = [];
  let cursor = start;
  for (let i = 0; i < 6; i++) {
    const year = i < 3 ? 1 : 2, index = (i % 3) + 1;
    const end = addDays(cursor, len - 1);
    data.push({ cohortId: cohort.id, year, index, name: `Year ${year} · Term ${index}`, start: cursor, end });
    cursor = addDays(end, 1);
  }
  await prisma.term.createMany({ data });
  const terms = await prisma.term.findMany({ where: { cohortId: cohort.id }, orderBy: [{ year: "asc" }, { index: "asc" }] });
  res.status(201).json(terms.map(sTerm));
});

router.put("/terms/:id", requireAuth, requireAdmin, async (req, res) => {
  const existing = await prisma.term.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Term not found" });
  const data = {};
  if (req.body?.name !== undefined) { const n = str(req.body.name); if (!n) return res.status(400).json({ error: "Term name required" }); data.name = n; }
  if (req.body?.start !== undefined) { if (!isDate(str(req.body.start))) return res.status(400).json({ error: "Valid start date required (YYYY-MM-DD)" }); data.start = str(req.body.start); }
  if (req.body?.end !== undefined) { if (!isDate(str(req.body.end))) return res.status(400).json({ error: "Valid end date required (YYYY-MM-DD)" }); data.end = str(req.body.end); }
  const start = data.start ?? existing.start, end = data.end ?? existing.end;
  if (end < start) return res.status(400).json({ error: "End date must be on or after the start date" });
  const t = await prisma.term.update({ where: { id: existing.id }, data });
  res.json(sTerm(t));
});

router.delete("/terms/:id", requireAuth, requireAdmin, async (req, res) => {
  try { await prisma.term.delete({ where: { id: req.params.id } }); res.json({ ok: true }); }
  catch (_e) { res.status(404).json({ error: "Term not found" }); }
});

/* ============================== modules ============================== */

router.get("/modules", requireAuth, async (_req, res) => {
  // Two grouped aggregations instead of a per-module _count (which issues a
  // correlated subquery per row and collapsed at scale). Same response shape.
  const [rows, enrolAgg, sessAgg] = await Promise.all([
    prisma.hndModule.findMany({ orderBy: { code: "asc" } }),
    prisma.enrolment.groupBy({ by: ["moduleId"], _count: { _all: true } }),
    prisma.hndSession.groupBy({ by: ["moduleId"], _count: { _all: true }, _max: { date: true } }),
  ]);
  const eMap = new Map(enrolAgg.map((e) => [e.moduleId, e._count._all]));
  const sMap = new Map(sessAgg.map((s) => [s.moduleId, s._count._all]));
  const endMap = new Map(sessAgg.map((s) => [s.moduleId, s._max.date || null]));
  res.json(rows.map((m) => ({ ...sModule(m), studentCount: eMap.get(m.id) || 0, sessionCount: sMap.get(m.id) || 0, endDate: endMap.get(m.id) || null })));
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
  const ct = await resolveCohortTerm(req.body?.cohortId, req.body?.termId);
  if (ct.error) return res.status(400).json({ error: ct.error });
  const m = await prisma.hndModule.create({
    data: { code, name, tutor: str(req.body?.tutor), programmeId: prog.skip ? null : prog.value, cohortId: ct.cohortId, termId: ct.termId },
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
  // cohort/term are set together (the UI picks a cohort then its term).
  if (req.body?.cohortId !== undefined || req.body?.termId !== undefined) {
    const ct = await resolveCohortTerm(req.body?.cohortId, req.body?.termId);
    if (ct.error) return res.status(400).json({ error: ct.error });
    data.cohortId = ct.cohortId; data.termId = ct.termId;
  }
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
  const cohortId = str(req.body?.cohortId) || null;
  if (cohortId && !(await prisma.cohort.findUnique({ where: { id: cohortId } }))) return res.status(400).json({ error: "Unknown cohort" });

  const s = await prisma.student.create({
    data: {
      firstName, lastName, studentRef, email, cohortId,
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
  if (req.body?.cohortId !== undefined) {
    const cohortId = str(req.body.cohortId) || null;
    if (cohortId && !(await prisma.cohort.findUnique({ where: { id: cohortId } }))) return res.status(400).json({ error: "Unknown cohort" });
    data.cohortId = cohortId;
  }

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
    // Oldest first: the start-date register is on top, and within a day the earlier
    // block (e.g. 09:00 before 13:00) comes first.
    prisma.hndSession.findMany({ where: moduleId ? { moduleId } : undefined, orderBy: [{ date: "asc" }, { startTime: "asc" }] }),
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
      kind: str(req.body?.kind) || "",
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
  if (req.body?.kind !== undefined) data.kind = str(req.body.kind);
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
  const audience = str(req.body?.audience) || "All students";
  if (!isDate(start) || !isDate(end)) return res.status(400).json({ error: "Valid start and end dates required (YYYY-MM-DD)" });
  if (end < start) return res.status(400).json({ error: "End date must be on or after the start date" });

  // Registers per class day come from the taught hours: each register covers 3 hours,
  // so 3h → 1 register, 6h → 2, and so on. Registers fall into fixed 3-hour blocks.
  const hours = Number(req.body?.hours);
  const HOURS_PER_REGISTER = 3;
  const BLOCKS = [["10:00", "13:00"], ["14:00", "17:00"], ["17:00", "20:00"], ["20:00", "23:00"]];
  let blocks;
  if (Number.isFinite(hours) && hours > 0) {
    const perDay = Math.min(Math.max(1, Math.round(hours / HOURS_PER_REGISTER)), BLOCKS.length);
    blocks = BLOCKS.slice(0, perDay);
  } else {
    // Backward-compatible fallback: a single register at any supplied times.
    const st = isTime(str(req.body?.startTime)) ? str(req.body.startTime) : "09:00";
    const et = isTime(str(req.body?.endTime)) ? str(req.body.endTime) : "12:00";
    blocks = [[st, et]];
  }

  // Step weekly in UTC so a timezone can't nudge a date across midnight.
  const dates = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cursor <= last && dates.length < MAX_WEEKLY_SESSIONS) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }

  // A register is unique per (date, block start-time), so we can add missing blocks
  // without duplicating ones already generated.
  const existing = await prisma.hndSession.findMany({ where: { moduleId: mod.id, date: { in: dates } }, select: { date: true, startTime: true } });
  const have = new Set(existing.map((x) => `${x.date}|${x.startTime}`));
  // On a multi-register day the first block is Teaching, the second a Seminar.
  const KINDS = ["Teaching", "Seminar", "Teaching", "Seminar"];
  const toCreate = [];
  for (const date of dates) {
    blocks.forEach(([s, e], i) => {
      if (!have.has(`${date}|${s}`)) toCreate.push({ moduleId: mod.id, date, startTime: s, endTime: e, description: mod.code, audience, kind: KINDS[i] || "" });
    });
  }
  if (toCreate.length) await prisma.hndSession.createMany({ data: toCreate });
  res.status(201).json({ ok: true, weeks: dates.length, registersPerWeek: blocks.length, created: toCreate.length });
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
  const session = await prisma.hndSession.findUnique({ where: { id: req.params.id }, include: { module: { include: { term: true } } } });
  if (!session) return res.status(404).json({ error: "Session not found" });

  // Term gate: if the unit belongs to a term, only its ACTIVE window (today within
  // the term dates) accepts marks. A past or not-yet-started term is locked, so
  // attendance "pauses" when the term ends — unless an admin reopens it to fix a
  // mark (override:true). Units with no term are unaffected.
  const term = session.module?.term;
  if (term && req.body?.override !== true) {
    const today = localDate();
    if (today < term.start || today > term.end) {
      return res.status(423).json({ error: `${term.name} is ${today > term.end ? "over" : "not open yet"} — reopen it to edit this register.`, locked: true });
    }
  }

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

  let scope = null; // null = everything (cumulative)
  // ?termId=<id> scopes to one term's date range — attendance for that term only.
  const termId = str(req.query?.termId);
  if (termId) {
    const term = await prisma.term.findUnique({ where: { id: termId } });
    if (!term) return res.status(404).json({ error: "Term not found" });
    scope = (date) => date >= term.start && date <= term.end;
  } else if (semesterId === "unassigned") {
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

// GET /api/hnd/students/:id/attendance-terms
// A student's attendance split into CURRENT vs PREVIOUS modules by each module's own
// end date. A module's end date is its last scheduled session (the "end date" set when
// its registers were created). Once that date passes, the module has finished and drops
// into "previous"; the overall % counts only the modules still running, so it rolls
// over automatically as modules finish.
router.get("/students/:id/attendance-terms", requireAuth, async (req, res) => {
  const student = await prisma.student.findUnique({ where: { id: req.params.id }, include: { enrolments: { select: { moduleId: true } } } });
  if (!student) return res.status(404).json({ error: "Student not found" });
  const enrolledIds = student.enrolments.map((e) => e.moduleId);
  const safeIds = enrolledIds.length ? enrolledIds : ["__none__"];

  const [modules, marks, sessions] = await Promise.all([
    prisma.hndModule.findMany({ where: { id: { in: safeIds } } }),
    prisma.attendanceMark.findMany({ where: { studentId: student.id }, select: { status: true, sessionId: true } }),
    prisma.hndSession.findMany({ where: { moduleId: { in: safeIds } }, select: { id: true, moduleId: true, date: true } }),
  ]);

  const today = localDate();

  // Each module's end date = the date of its last scheduled session.
  const endByModule = new Map();
  const sessMod = new Map();
  for (const s of sessions) {
    sessMod.set(s.id, s.moduleId);
    const cur = endByModule.get(s.moduleId);
    if (!cur || s.date > cur) endByModule.set(s.moduleId, s.date);
  }

  const marksByModule = new Map();
  for (const m of marks) { const mid = sessMod.get(m.sessionId); if (!mid) continue; if (!marksByModule.has(mid)) marksByModule.set(mid, []); marksByModule.get(mid).push(m); }

  // A module is "finished" once its last session date is in the past. Modules with no
  // sessions yet have no end date, so they stay current.
  const rowFor = (mod) => {
    const endDate = endByModule.get(mod.id) || null;
    return { module: sModule(mod), summary: summarise(marksByModule.get(mod.id) || []), endDate, finished: !!(endDate && endDate < today) };
  };
  const rows = modules.map(rowFor);
  const currentRows = rows.filter((r) => !r.finished).sort((a, b) => (a.endDate || "9999").localeCompare(b.endDate || "9999"));
  const previousRows = rows.filter((r) => r.finished).sort((a, b) => (b.endDate || "").localeCompare(a.endDate || ""));

  const currentOverall = summarise(currentRows.flatMap((r) => marksByModule.get(r.module.id) || []));

  res.json({
    studentId: student.id,
    cohortId: student.cohortId || null,
    today,
    current: { modules: currentRows, overall: currentOverall },
    previous: previousRows,
  });
});

module.exports = router;
