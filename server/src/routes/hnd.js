// HND attendance registers — units, students, enrolments, sessions, marks.
// Reads require a signed-in user; every mutation is admin-only, matching the
// rest of the admin console.
const router = require("express").Router();
const prisma = require("../db");
const { sSemester, sCourse, sCohort, sTerm, sUnit, sStudent, sSession, sMark } = require("../serializers");
const { requireAuth, requireAnyPage } = require("../auth");
// Mutating registers/units/courses needs one of the sections that manages them.
// (Previously these used requireAdmin, which only checks the ADMIN role — and being
// granted ANY single page makes an account an ADMIN, so a read-only "executive"
// admin would have been able to write here.)
const requireHndWrite = requireAnyPage(["registers", "students"]);
const { isStatus, summarise, summariseCounts } = require("../attendance");

// DEF-01: HND registers are an admin-only feature (they live entirely in the admin
// dashboard; no staff/mobile flow reads them). Guard EVERY route — reads included —
// so a non-admin token cannot read the student directory, attendance matrix or
// registers. Individual routes keep their own write guard too (defence in depth).
// "executive" is included because the Executive Dashboard reads courses, units,
// sessions and the monthly attendance summary from here; every WRITE route below
// additionally requires requireHndWrite, so this only ever grants read access.
router.use(requireAuth, requireAnyPage(["registers", "students", "executive"]));

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

router.post("/semesters", requireAuth, requireHndWrite, async (req, res) => {
  const v = await validateSemester(req.body, null);
  if (v.error) return res.status(400).json({ error: v.error });
  const s = await prisma.semester.create({ data: v.data });
  res.status(201).json(sSemester(s));
});

router.put("/semesters/:id", requireAuth, requireHndWrite, async (req, res) => {
  const existing = await prisma.semester.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Semester not found" });
  const v = await validateSemester({ ...existing, ...req.body }, existing.id);
  if (v.error) return res.status(400).json({ error: v.error });
  const s = await prisma.semester.update({ where: { id: existing.id }, data: v.data });
  res.json(sSemester(s));
});

// Deleting a semester never touches sessions or marks — it only changes how
// they're grouped, so the underlying registers are always safe.
router.delete("/semesters/:id", requireAuth, requireHndWrite, async (req, res) => {
  try { await prisma.semester.delete({ where: { id: req.params.id } }); res.json({ ok: true }); }
  catch (_e) { res.status(404).json({ error: "Semester not found" }); }
});

/* ============================== courses ============================== */
// A course (e.g. "HND Business") groups the units taught under it. Deleting
// one leaves its units intact but unassigned (schema-level onDelete: SetNull),
// so no register is ever lost by reorganising the course structure.

// Resolve a courseId from the body into a value Prisma can store. Returns
// { value } on success (null clears the link) or { error } if the id is unknown.
async function resolveCourse(raw) {
  if (raw === undefined) return { skip: true };
  const id = str(raw);
  if (!id) return { value: null };
  const exists = await prisma.course.findUnique({ where: { id } });
  if (!exists) return { error: "Unknown course" };
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

router.get("/courses", requireAuth, async (_req, res) => {
  const rows = await prisma.course.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { units: true, cohorts: true } } },
  });
  res.json(rows.map(sCourse));
});

router.post("/courses", requireAuth, requireHndWrite, async (req, res) => {
  const name = str(req.body?.name);
  if (!name) return res.status(400).json({ error: "Course name required" });
  const clash = await prisma.course.findFirst({ where: { name: { equals: name } } });
  if (clash) return res.status(409).json({ error: `A course called "${name}" already exists` });
  const colour = str(req.body?.colour) || colourFor(name);
  const p = await prisma.course.create({ data: { name, colour }, include: { _count: { select: { units: true, cohorts: true } } } });
  res.status(201).json(sCourse(p));
});

router.put("/courses/:id", requireAuth, requireHndWrite, async (req, res) => {
  const existing = await prisma.course.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Course not found" });
  const data = {};
  if (req.body?.name !== undefined) {
    const name = str(req.body.name);
    if (!name) return res.status(400).json({ error: "Course name required" });
    const clash = await prisma.course.findFirst({ where: { name: { equals: name }, id: { not: existing.id } } });
    if (clash) return res.status(409).json({ error: `A course called "${name}" already exists` });
    data.name = name;
  }
  if (req.body?.colour !== undefined) data.colour = str(req.body.colour) || existing.colour;
  const p = await prisma.course.update({ where: { id: existing.id }, data, include: { _count: { select: { units: true, cohorts: true } } } });
  res.json(sCourse(p));
});

// Units are un-assigned (not deleted) when their course goes.
router.delete("/courses/:id", requireAuth, requireHndWrite, async (req, res) => {
  try { await prisma.course.delete({ where: { id: req.params.id } }); res.json({ ok: true }); }
  catch (_e) { res.status(404).json({ error: "Course not found" }); }
});

/* ============================== cohorts ============================== */
// An intake of students on a course, e.g. "SEP 2025". One course runs many
// cohorts over time; each name is unique within its course.

router.get("/cohorts", requireAuth, async (req, res) => {
  const courseId = str(req.query?.courseId);
  const where = courseId ? { courseId } : {};
  const rows = await prisma.cohort.findMany({ where, orderBy: [{ courseId: "asc" }, { createdAt: "asc" }] });
  res.json(rows.map(sCohort));
});

router.post("/cohorts", requireAuth, requireHndWrite, async (req, res) => {
  const name = str(req.body?.name);
  const courseId = str(req.body?.courseId);
  const startDate = str(req.body?.startDate) || null;
  if (!name) return res.status(400).json({ error: "Cohort name required" });
  if (!courseId) return res.status(400).json({ error: "Course is required" });
  if (startDate && !isDate(startDate)) return res.status(400).json({ error: "Start date must be a valid date (YYYY-MM-DD)" });
  const prog = await prisma.course.findUnique({ where: { id: courseId } });
  if (!prog) return res.status(400).json({ error: "Unknown course" });
  const clash = await prisma.cohort.findFirst({ where: { courseId, name } });
  if (clash) return res.status(409).json({ error: `"${name}" already exists on this course` });
  try {
    const c = await prisma.cohort.create({ data: { name, courseId, startDate } });
    res.status(201).json(sCohort(c));
  } catch (_e) { res.status(400).json({ error: "Could not create the cohort" }); }
});

router.put("/cohorts/:id", requireAuth, requireHndWrite, async (req, res) => {
  const existing = await prisma.cohort.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Cohort not found" });
  const data = {};
  if (req.body?.name !== undefined) {
    const name = str(req.body.name);
    if (!name) return res.status(400).json({ error: "Cohort name required" });
    const clash = await prisma.cohort.findFirst({ where: { courseId: existing.courseId, name, id: { not: existing.id } } });
    if (clash) return res.status(409).json({ error: `"${name}" already exists on this course` });
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

router.delete("/cohorts/:id", requireAuth, requireHndWrite, async (req, res) => {
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
router.post("/cohorts/:id/terms/generate", requireAuth, requireHndWrite, async (req, res) => {
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
  try {
    await prisma.term.createMany({ data });
  } catch (e) {
    // Two generate calls can both pass the count check above; the loser trips the
    // (cohortId, year, index) unique index. Report that as the same clean 409.
    if (e?.code === "P2002") return res.status(409).json({ error: "This cohort already has terms — edit or delete them first" });
    throw e;
  }
  const terms = await prisma.term.findMany({ where: { cohortId: cohort.id }, orderBy: [{ year: "asc" }, { index: "asc" }] });
  res.status(201).json(terms.map(sTerm));
});

router.put("/terms/:id", requireAuth, requireHndWrite, async (req, res) => {
  const existing = await prisma.term.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Term not found" });
  const data = {};
  if (req.body?.name !== undefined) { const n = str(req.body.name); if (!n) return res.status(400).json({ error: "Term name required" }); data.name = n; }
  if (req.body?.start !== undefined) { if (!isDate(str(req.body.start))) return res.status(400).json({ error: "Valid start date required (YYYY-MM-DD)" }); data.start = str(req.body.start); }
  if (req.body?.end !== undefined) { if (!isDate(str(req.body.end))) return res.status(400).json({ error: "Valid end date required (YYYY-MM-DD)" }); data.end = str(req.body.end); }
  const start = data.start ?? existing.start, end = data.end ?? existing.end;
  if (end < start) return res.status(400).json({ error: "End date must be on or after the start date" });
  // Terms drive attendance locking, so two terms must never claim the same day —
  // otherwise two terms read as "current" and which register opens is arbitrary.
  const siblings = await prisma.term.findMany({ where: { cohortId: existing.cohortId, id: { not: existing.id } } });
  const clash = siblings.find((o) => overlaps({ start, end }, o));
  if (clash) return res.status(409).json({ error: `Those dates overlap ${clash.name} (${clash.start} → ${clash.end})` });
  const t = await prisma.term.update({ where: { id: existing.id }, data });
  // A gap between terms leaves days covered by no term at all, which silently locks
  // every register in that window. Not an error (the college may intend a break), but
  // report it so the UI can warn instead of leaving the admin to guess.
  const all = [...siblings, t].sort((a, b) => a.start.localeCompare(b.start));
  const gaps = [];
  for (let i = 1; i < all.length; i++) {
    if (addDays(all[i - 1].end, 1) < all[i].start) gaps.push({ after: all[i - 1].name, before: all[i].name, from: addDays(all[i - 1].end, 1), to: addDays(all[i].start, -1) });
  }
  res.json({ ...sTerm(t), gaps });
});

router.delete("/terms/:id", requireAuth, requireHndWrite, async (req, res) => {
  try { await prisma.term.delete({ where: { id: req.params.id } }); res.json({ ok: true }); }
  catch (_e) { res.status(404).json({ error: "Term not found" }); }
});

/* ============================== units ============================== */

router.get("/units", requireAuth, async (_req, res) => {
  // Two grouped aggregations instead of a per-unit _count (which issues a
  // correlated subquery per row and collapsed at scale). Same response shape.
  const [rows, enrolAgg, sessAgg] = await Promise.all([
    prisma.unit.findMany({ orderBy: { code: "asc" } }),
    prisma.enrolment.groupBy({ by: ["unitId"], _count: { _all: true } }),
    prisma.hndSession.groupBy({ by: ["unitId"], _count: { _all: true }, _max: { date: true } }),
  ]);
  const eMap = new Map(enrolAgg.map((e) => [e.unitId, e._count._all]));
  const sMap = new Map(sessAgg.map((s) => [s.unitId, s._count._all]));
  const endMap = new Map(sessAgg.map((s) => [s.unitId, s._max.date || null]));
  res.json(rows.map((m) => ({ ...sUnit(m), studentCount: eMap.get(m.id) || 0, sessionCount: sMap.get(m.id) || 0, endDate: endMap.get(m.id) || null })));
});

router.post("/units", requireAuth, requireHndWrite, async (req, res) => {
  const code = str(req.body?.code).toUpperCase();
  const name = str(req.body?.name);
  if (!code) return res.status(400).json({ error: "Unit code required" });
  if (!name) return res.status(400).json({ error: "Unit name required" });
  const prog = await resolveCourse(req.body?.courseId);
  if (prog.error) return res.status(400).json({ error: prog.error });
  const courseId = prog.skip ? null : prog.value;
  // Unit codes are unique WITHIN a course only — the same code may exist on another
  // course, so we scope the clash check to this unit's course. Note that the composite
  // unique index can't enforce this for course-LESS units (Postgres treats NULLs as
  // distinct), so for those this check is the only guard and two simultaneous creates
  // could still slip through; assigning a course closes that gap.
  const where = courseId ? { code, courseId } : { code, courseId: null };
  const clash = await prisma.unit.findFirst({ where });
  if (clash) return res.status(409).json({ error: courseId ? `Unit code "${code}" already exists in this course` : `Unit code "${code}" already exists among units with no course` });
  const ct = await resolveCohortTerm(req.body?.cohortId, req.body?.termId);
  if (ct.error) return res.status(400).json({ error: ct.error });
  try {
    const m = await prisma.unit.create({
      data: { code, name, tutor: str(req.body?.tutor), courseId, cohortId: ct.cohortId, termId: ct.termId },
    });
    res.status(201).json(sUnit(m));
  } catch (e) {
    // P2002 = the DB's unique index rejected it. A clean 409 beats a raw 500.
    if (e?.code === "P2002") return res.status(409).json({ error: courseId ? `Unit code "${code}" already exists in this course` : `Unit code "${code}" is already in use` });
    throw e;
  }
});

router.put("/units/:id", requireAuth, requireHndWrite, async (req, res) => {
  const existing = await prisma.unit.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Unit not found" });
  const data = {};
  // Resolve the target course first — the code-uniqueness check is scoped to it.
  const prog = await resolveCourse(req.body?.courseId);
  if (prog.error) return res.status(400).json({ error: prog.error });
  const courseChanging = !prog.skip;
  const targetCourseId = courseChanging ? prog.value : existing.courseId;
  if (courseChanging) data.courseId = prog.value;
  const codeChanging = req.body?.code !== undefined;
  const effectiveCode = codeChanging ? str(req.body.code).toUpperCase() : existing.code;
  if (codeChanging && !effectiveCode) return res.status(400).json({ error: "Unit code required" });
  // Re-check uniqueness within the (possibly new) course whenever code OR course moves.
  if (codeChanging || courseChanging) {
    const clash = await prisma.unit.findFirst({ where: { code: effectiveCode, courseId: targetCourseId, id: { not: existing.id } } });
    if (clash) return res.status(409).json({ error: `Unit code "${effectiveCode}" already exists in ${targetCourseId ? "this course" : "the no-course group"}` });
  }
  if (codeChanging) data.code = effectiveCode;
  if (req.body?.name !== undefined) {
    const name = str(req.body.name);
    if (!name) return res.status(400).json({ error: "Unit name required" });
    data.name = name;
  }
  if (req.body?.tutor !== undefined) data.tutor = str(req.body.tutor);
  // cohort/term are set together (the UI picks a cohort then its term).
  if (req.body?.cohortId !== undefined || req.body?.termId !== undefined) {
    const ct = await resolveCohortTerm(req.body?.cohortId, req.body?.termId);
    if (ct.error) return res.status(400).json({ error: ct.error });
    data.cohortId = ct.cohortId; data.termId = ct.termId;
  }
  try {
    const m = await prisma.unit.update({ where: { id: existing.id }, data });
    res.json(sUnit(m));
  } catch (e) {
    if (e?.code === "P2002") return res.status(409).json({ error: `Unit code "${data.code || existing.code}" already exists in ${targetCourseId ? "this course" : "the no-course group"}` });
    throw e;
  }
});

// Deleting a unit cascades to its sessions, marks and enrolments (schema-level).
router.delete("/units/:id", requireAuth, requireHndWrite, async (req, res) => {
  try { await prisma.unit.delete({ where: { id: req.params.id } }); res.json({ ok: true }); }
  catch (_e) { res.status(404).json({ error: "Unit not found" }); }
});

// Set which students are enrolled on a unit — the unit-side mirror of
// PUT /students/:id/enrolments. Replaces the whole set; un-enrolling a student
// deliberately KEEPS any marks they already have, so past registers still read
// as they were taken.
router.put("/units/:id/enrolments", requireAuth, requireHndWrite, async (req, res) => {
  const mod = await prisma.unit.findUnique({ where: { id: req.params.id } });
  if (!mod) return res.status(404).json({ error: "Unit not found" });
  if (!Array.isArray(req.body?.studentIds)) return res.status(400).json({ error: "studentIds must be an array of student ids" });
  if (req.body.studentIds.some((x) => typeof x !== "string")) return res.status(400).json({ error: "studentIds must contain only student ids" });
  const studentIds = [...new Set(req.body.studentIds)];
  if (studentIds.length) {
    const found = await prisma.student.count({ where: { id: { in: studentIds } } });
    if (found !== studentIds.length) return res.status(400).json({ error: "One or more students do not exist" });
  }
  await prisma.$transaction([
    prisma.enrolment.deleteMany({ where: { unitId: mod.id, studentId: { notIn: studentIds.length ? studentIds : ["__none__"] } } }),
    ...studentIds.map((studentId) => prisma.enrolment.upsert({
      where: { studentId_unitId: { studentId, unitId: mod.id } },
      create: { studentId, unitId: mod.id },
      update: {},
    })),
  ]);
  const m = await prisma.unit.findUnique({ where: { id: mod.id }, include: { _count: { select: { sessions: true, enrolments: true } } } });
  res.json(sUnit(m));
});

/* ============================== students ============================== */

router.get("/students", requireAuth, async (_req, res) => {
  const rows = await prisma.student.findMany({
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    include: { enrolments: { select: { unitId: true } } },
  });
  res.json(rows.map(sStudent));
});

router.post("/students", requireAuth, requireHndWrite, async (req, res) => {
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

  // Validate enrolments up front so a bad unitId can't blow up the nested create.
  const unitIds = Array.isArray(req.body?.unitIds) ? [...new Set(req.body.unitIds.filter((x) => typeof x === "string"))] : [];
  if (unitIds.length) {
    const found = await prisma.unit.count({ where: { id: { in: unitIds } } });
    if (found !== unitIds.length) return res.status(400).json({ error: "One or more units do not exist" });
  }
  const cohortId = str(req.body?.cohortId) || null;
  if (cohortId && !(await prisma.cohort.findUnique({ where: { id: cohortId } }))) return res.status(400).json({ error: "Unknown cohort" });

  const s = await prisma.student.create({
    data: {
      firstName, lastName, studentRef, email, cohortId,
      initials: initialsOf(firstName, lastName),
      colour: colourFor(studentRef + lastName),
      enrolments: { create: unitIds.map((unitId) => ({ unitId })) },
    },
    include: { enrolments: { select: { unitId: true } } },
  });
  res.status(201).json(sStudent(s));
});

router.put("/students/:id", requireAuth, requireHndWrite, async (req, res) => {
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
    include: { enrolments: { select: { unitId: true } } },
  });
  res.json(sStudent(s));
});

router.delete("/students/:id", requireAuth, requireHndWrite, async (req, res) => {
  const existing = await prisma.student.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Student not found" });
  try {
    // Enrolments, attendance marks, grades and PAT interactions cascade at the DB
    // level. Their SignupRequest does NOT — it is matched only by email, which is
    // @unique, so a leftover row would silently stop this person ever signing up
    // again (the endpoint would see a live request and create nothing).
    await prisma.$transaction([
      prisma.signupRequest.deleteMany({ where: { email: existing.email } }),
      prisma.student.delete({ where: { id: existing.id } }),
    ]);
    res.json({ ok: true });
  } catch (_e) { res.status(400).json({ error: "Could not delete this student" }); }
});

// Replace a student's unit enrolments wholesale.
// Un-enrolling drops the student from future registers but deliberately KEEPS
// their existing marks, so past registers still read as they were taken.
router.put("/students/:id/enrolments", requireAuth, requireHndWrite, async (req, res) => {
  const student = await prisma.student.findUnique({ where: { id: req.params.id } });
  if (!student) return res.status(404).json({ error: "Student not found" });
  // This is the one call that can wipe a student's whole enrolment set, so malformed
  // input must NOT be read as "clear everything". Sending a string, or omitting the
  // field, previously dropped the student off every register with a cheerful 200.
  if (!Array.isArray(req.body?.unitIds)) return res.status(400).json({ error: "unitIds must be an array of unit ids" });
  if (req.body.unitIds.some((x) => typeof x !== "string")) return res.status(400).json({ error: "unitIds must contain only unit ids" });
  const unitIds = [...new Set(req.body.unitIds)];
  if (unitIds.length) {
    const found = await prisma.unit.count({ where: { id: { in: unitIds } } });
    if (found !== unitIds.length) return res.status(400).json({ error: "One or more units do not exist" });
  }
  await prisma.$transaction([
    prisma.enrolment.deleteMany({ where: { studentId: student.id, unitId: { notIn: unitIds.length ? unitIds : ["__none__"] } } }),
    ...unitIds.map((unitId) => prisma.enrolment.upsert({
      where: { studentId_unitId: { studentId: student.id, unitId } },
      create: { studentId: student.id, unitId },
      update: {},
    })),
  ]);
  const s = await prisma.student.findUnique({ where: { id: student.id }, include: { enrolments: { select: { unitId: true } } } });
  res.json(sStudent(s));
});

/* ============================== sessions ============================== */

router.get("/sessions", requireAuth, async (req, res) => {
  const unitId = str(req.query?.unitId);
  const [rows, agg] = await Promise.all([
    // Oldest first: the start-date register is on top, and within a day the earlier
    // block (e.g. 09:00 before 13:00) comes first.
    prisma.hndSession.findMany({ where: unitId ? { unitId } : undefined, orderBy: [{ date: "asc" }, { startTime: "asc" }] }),
    prisma.attendanceMark.groupBy({ by: ["sessionId"], _count: { _all: true }, where: unitId ? { session: { unitId } } : undefined }),
  ]);
  const cMap = new Map(agg.map((a) => [a.sessionId, a._count._all]));
  res.json(rows.map((s) => ({ ...sSession(s), markedCount: cMap.get(s.id) || 0 })));
});

router.post("/sessions", requireAuth, requireHndWrite, async (req, res) => {
  const unitId = str(req.body?.unitId);
  const date = str(req.body?.date);
  const start = str(req.body?.start);
  const end = str(req.body?.end);
  if (!unitId) return res.status(400).json({ error: "Unit required" });
  const mod = await prisma.unit.findUnique({ where: { id: unitId } });
  if (!mod) return res.status(400).json({ error: "Unknown unit" });
  if (!isDate(date)) return res.status(400).json({ error: "Valid date required (YYYY-MM-DD)" });
  if (!isTime(start) || !isTime(end)) return res.status(400).json({ error: "Valid start and end times required (HH:MM)" });
  if (end <= start) return res.status(400).json({ error: "End time must be after the start time" });

  const s = await prisma.hndSession.create({
    data: {
      unitId, date, startTime: start, endTime: end,
      description: str(req.body?.description) || mod.code,
      audience: str(req.body?.audience) || "All students",
      kind: str(req.body?.kind) || "",
    },
  });
  res.status(201).json(sSession(s));
});

router.put("/sessions/:id", requireAuth, requireHndWrite, async (req, res) => {
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

router.delete("/sessions/:id", requireAuth, requireHndWrite, async (req, res) => {
  try { await prisma.hndSession.delete({ where: { id: req.params.id } }); res.json({ ok: true }); }
  catch (_e) { res.status(404).json({ error: "Session not found" }); }
});

// Generate one weekly session for a unit across a date range — the same weekday
// as the start date, every 7 days up to and including the end date. Used when a
// course is created with a term start/end so its whole register schedule appears
// at once. Idempotent: dates that already have a session for this unit are
// skipped, so re-running never duplicates.
const MAX_WEEKLY_SESSIONS = 60; // ~14 months of weeks — a safety cap, not a limit anyone hits
router.post("/units/:id/sessions/generate", requireAuth, requireHndWrite, async (req, res) => {
  const mod = await prisma.unit.findUnique({ where: { id: req.params.id } });
  if (!mod) return res.status(404).json({ error: "Unit not found" });

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
  const existing = await prisma.hndSession.findMany({ where: { unitId: mod.id, date: { in: dates } }, select: { date: true, startTime: true } });
  const have = new Set(existing.map((x) => `${x.date}|${x.startTime}`));
  // On a multi-register day the first block is Teaching, the second a Seminar.
  const KINDS = ["Teaching", "Seminar", "Teaching", "Seminar"];
  const toCreate = [];
  for (const date of dates) {
    blocks.forEach(([s, e], i) => {
      if (!have.has(`${date}|${s}`)) toCreate.push({ unitId: mod.id, date, startTime: s, endTime: e, description: mod.code, audience, kind: KINDS[i] || "" });
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
    include: { unit: true, marks: true },
  });
  if (!session) return res.status(404).json({ error: "Session not found" });

  const enrolments = await prisma.enrolment.findMany({
    where: { unitId: session.unitId },
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
    unit: sUnit(session.unit),
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
router.put("/sessions/:id/register", requireAuth, requireHndWrite, async (req, res) => {
  const session = await prisma.hndSession.findUnique({ where: { id: req.params.id }, include: { unit: { include: { term: true } } } });
  if (!session) return res.status(404).json({ error: "Session not found" });

  // Term gate: if the unit belongs to a term, only its ACTIVE window (today within
  // the term dates) accepts marks. A past or not-yet-started term is locked, so
  // attendance "pauses" when the term ends — unless an admin reopens it to fix a
  // mark (override:true). Units with no term are unaffected.
  const term = session.unit?.term;
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

// The attendance matrix: every student's percentage per unit, their overall
// percentage across all units, and the cohort figures per unit + overall.
//
// ?semesterId=<id>       -> only sessions dated inside that semester
// ?semesterId=unassigned -> only sessions outside every semester
// (omitted)              -> every session on record
// GET /hnd/attendance/monthly?studentId= — attendance % bucketed by calendar month,
// for the whole college (default) or a single student. Counting happens IN POSTGRES
// (GROUP BY on left(date,7) = 'YYYY-MM') so it stays memory-safe at scale, exactly
// like the /attendance matrix. Powers the dashboards' "Attendance % by Year & Month".
router.get("/attendance/monthly", requireAuth, async (req, res) => {
  const studentId = str(req.query?.studentId);
  const unitId = str(req.query?.unitId);
  const courseId = str(req.query?.courseId);
  // Only join Unit when we need to filter by course.
  const unitJoin = courseId ? `JOIN "Unit" u ON u.id = se."unitId"` : "";
  const base = `
    SELECT left(se.date, 7) ym,
      count(*) FILTER (WHERE am.status='P')::int p,
      count(*) FILTER (WHERE am.status='L')::int l,
      count(*) FILTER (WHERE am.status='E')::int e,
      count(*) FILTER (WHERE am.status='A')::int a
    FROM "AttendanceMark" am JOIN "HndSession" se ON se.id = am."sessionId" ${unitJoin}`;
  const conds = [], params = [];
  if (studentId) { params.push(studentId); conds.push(`am."studentId" = $${params.length}`); }
  if (unitId) { params.push(unitId); conds.push(`se."unitId" = $${params.length}`); }
  if (courseId) { params.push(courseId); conds.push(`u."courseId" = $${params.length}`); }
  const where = conds.length ? ` WHERE ${conds.join(" AND ")}` : "";
  const rows = await prisma.$queryRawUnsafe(`${base}${where} GROUP BY 1 ORDER BY 1`, ...params);
  let P = 0, L = 0, E = 0, A = 0;
  const months = rows.map((r) => {
    P += r.p; L += r.l; E += r.e; A += r.a;
    const s = summariseCounts(r.p, r.l, r.e, r.a);
    return { month: r.ym, pct: s.pct, marked: s.marked, P: r.p, L: r.l, E: r.e, A: r.a };
  });
  const t = summariseCounts(P, L, E, A);
  // Session count under the SAME course/unit scope (independent of student/marks),
  // so the dashboard's "Total Sessions" tracks the filters too.
  const sJoin = courseId ? `JOIN "Unit" u ON u.id = se."unitId"` : "";
  const sConds = [], sParams = [];
  if (unitId) { sParams.push(unitId); sConds.push(`se."unitId" = $${sParams.length}`); }
  if (courseId) { sParams.push(courseId); sConds.push(`u."courseId" = $${sParams.length}`); }
  const sWhere = sConds.length ? ` WHERE ${sConds.join(" AND ")}` : "";
  const sessRows = await prisma.$queryRawUnsafe(`SELECT count(*)::int n FROM "HndSession" se ${sJoin}${sWhere}`, ...sParams);
  res.json({ months, totals: { pct: t.pct, marked: t.marked, present: P, late: L, excused: E, absent: A }, sessions: sessRows[0]?.n || 0 });
});

router.get("/attendance", requireAuth, async (req, res) => {
  const semesterId = str(req.query?.semesterId);
  const semesters = await prisma.semester.findMany({ orderBy: { start: "asc" } });

  // ?termId=<id> scopes to one term's dates; ?semesterId scopes to a semester (or
  // "unassigned" = outside every semester); omitted = everything cumulative.
  const termId = str(req.query?.termId);
  const term = termId ? await prisma.term.findUnique({ where: { id: termId } }) : null;
  if (termId && !term) return res.status(404).json({ error: "Term not found" });
  if (semesterId && semesterId !== "unassigned" && !semesters.some((s) => s.id === semesterId))
    return res.status(404).json({ error: "Semester not found" });

  // The date scope as a SQL predicate on a session-date column, so the counting
  // happens IN POSTGRES. Previously this pulled every AttendanceMark row into Node
  // and grouped them in memory, which OOM-crashed the server at scale. Values come
  // from our own semester/term rows (never user input), so inlining them is safe.
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const dateCond = (col) => {
    if (termId) { return `${col} >= ${q(term.start)} AND ${col} <= ${q(term.end)}`; }
    if (semesterId === "unassigned") {
      if (!semesters.length) return "TRUE";
      return `NOT (${semesters.map((s) => `(${col} >= ${q(s.start)} AND ${col} <= ${q(s.end)})`).join(" OR ")})`;
    }
    if (semesterId) { const sem = semesters.find((s) => s.id === semesterId); return `${col} >= ${q(sem.start)} AND ${col} <= ${q(sem.end)}`; }
    return "TRUE";
  };

  const [units, students, perSM, sessAgg, enrolAgg] = await Promise.all([
    prisma.unit.findMany({ orderBy: { code: "asc" } }),
    prisma.student.findMany({
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      include: { enrolments: { select: { unitId: true } } },
    }),
    // One aggregate row per (student, unit): the four status counts, scoped by date.
    prisma.$queryRawUnsafe(`
      SELECT am."studentId" sid, se."unitId" mid,
        count(*) FILTER (WHERE am.status='P')::int p,
        count(*) FILTER (WHERE am.status='L')::int l,
        count(*) FILTER (WHERE am.status='E')::int e,
        count(*) FILTER (WHERE am.status='A')::int a
      FROM "AttendanceMark" am JOIN "HndSession" se ON se.id = am."sessionId"
      WHERE ${dateCond("se.date")}
      GROUP BY am."studentId", se."unitId"`),
    // Session counts per unit: all-time and scoped, in one pass.
    prisma.$queryRawUnsafe(`
      SELECT "unitId" mid, count(*)::int all_c,
        count(*) FILTER (WHERE ${dateCond("date")})::int scoped_c
      FROM "HndSession" GROUP BY "unitId"`),
    prisma.enrolment.groupBy({ by: ["unitId"], _count: { _all: true } }),
  ]);

  // studentId -> Map(unitId -> {P,L,E,A}); plus per-unit and global totals.
  const index = new Map();
  const modTot = new Map();
  const gTot = { P: 0, L: 0, E: 0, A: 0 };
  for (const r of perSM) {
    if (!index.has(r.sid)) index.set(r.sid, new Map());
    index.get(r.sid).set(r.mid, r);
    const mt = modTot.get(r.mid) || { P: 0, L: 0, E: 0, A: 0 };
    mt.P += r.p; mt.L += r.l; mt.E += r.e; mt.A += r.a; modTot.set(r.mid, mt);
    gTot.P += r.p; gTot.L += r.l; gTot.E += r.e; gTot.A += r.a;
  }

  const rows = students.map((s) => {
    const per = index.get(s.id) || new Map();
    const enrolledIds = new Set(s.enrolments.map((e) => e.unitId));
    const relevant = new Set([...enrolledIds, ...per.keys()]);
    const unitsOut = {};
    const acc = { P: 0, L: 0, E: 0, A: 0 };
    for (const modId of relevant) {
      const c = per.get(modId) || { p: 0, l: 0, e: 0, a: 0 };
      unitsOut[modId] = { ...summariseCounts(c.p, c.l, c.e, c.a), enrolled: enrolledIds.has(modId) };
      acc.P += c.p; acc.L += c.l; acc.E += c.e; acc.A += c.a;
    }
    return { student: sStudent(s), units: unitsOut, overall: summariseCounts(acc.P, acc.L, acc.E, acc.A) };
  });

  const scopedSess = new Map(), allSess = new Map();
  for (const r of sessAgg) { scopedSess.set(r.mid, r.scoped_c); allSess.set(r.mid, r.all_c); }
  const enrolCount = new Map(enrolAgg.map((e) => [e.unitId, e._count._all]));
  const scopedSessionTotal = sessAgg.reduce((n, r) => n + r.scoped_c, 0);

  const unitTotals = {};
  for (const mod of units) {
    const mt = modTot.get(mod.id) || { P: 0, L: 0, E: 0, A: 0 };
    unitTotals[mod.id] = { ...summariseCounts(mt.P, mt.L, mt.E, mt.A), sessionCount: scopedSess.get(mod.id) || 0 };
  }

  res.json({
    units: units.map((m) => ({ ...sUnit(m), studentCount: enrolCount.get(m.id) || 0, sessionCount: allSess.get(m.id) || 0 })),
    rows,
    unitTotals,
    overall: summariseCounts(gTot.P, gTot.L, gTot.E, gTot.A),
    scope: { semesterId: semesterId || "", sessionCount: scopedSessionTotal },
  });
});

// GET /api/hnd/students/:id/attendance-terms
// A student's attendance split into CURRENT vs PREVIOUS units by each unit's own
// end date. A unit's end date is its last scheduled session (the "end date" set when
// its registers were created). Once that date passes, the unit has finished and drops
// into "previous"; the overall % counts only the units still running, so it rolls
// over automatically as units finish.
router.get("/students/:id/attendance-terms", requireAuth, async (req, res) => {
  const student = await prisma.student.findUnique({ where: { id: req.params.id }, include: { enrolments: { select: { unitId: true } } } });
  if (!student) return res.status(404).json({ error: "Student not found" });
  const enrolledIds = student.enrolments.map((e) => e.unitId);
  const safeIds = enrolledIds.length ? enrolledIds : ["__none__"];

  const [units, marks, sessions] = await Promise.all([
    prisma.unit.findMany({ where: { id: { in: safeIds } } }),
    prisma.attendanceMark.findMany({ where: { studentId: student.id }, select: { status: true, sessionId: true } }),
    prisma.hndSession.findMany({ where: { unitId: { in: safeIds } }, select: { id: true, unitId: true, date: true } }),
  ]);

  const today = localDate();

  // Each unit's end date = the date of its last scheduled session.
  const endByUnit = new Map();
  const sessMod = new Map();
  for (const s of sessions) {
    sessMod.set(s.id, s.unitId);
    const cur = endByUnit.get(s.unitId);
    if (!cur || s.date > cur) endByUnit.set(s.unitId, s.date);
  }

  const marksByUnit = new Map();
  for (const m of marks) { const mid = sessMod.get(m.sessionId); if (!mid) continue; if (!marksByUnit.has(mid)) marksByUnit.set(mid, []); marksByUnit.get(mid).push(m); }

  // A unit is "finished" once its last session date is in the past. Units with no
  // sessions yet have no end date, so they stay current.
  const rowFor = (mod) => {
    const endDate = endByUnit.get(mod.id) || null;
    return { unit: sUnit(mod), summary: summarise(marksByUnit.get(mod.id) || []), endDate, finished: !!(endDate && endDate < today) };
  };
  const rows = units.map(rowFor);
  const currentRows = rows.filter((r) => !r.finished).sort((a, b) => (a.endDate || "9999").localeCompare(b.endDate || "9999"));
  const previousRows = rows.filter((r) => r.finished).sort((a, b) => (b.endDate || "").localeCompare(a.endDate || ""));

  const currentOverall = summarise(currentRows.flatMap((r) => marksByUnit.get(r.unit.id) || []));

  res.json({
    studentId: student.id,
    cohortId: student.cohortId || null,
    today,
    current: { units: currentRows, overall: currentOverall },
    previous: previousRows,
  });
});

module.exports = router;
