// The student app's own endpoints. Every route is scoped to the signed-in student
// (req.user.id) — a student can only ever see their own data. requireAuth's student
// branch already blocks student tokens from every other router.
const router = require("express").Router();
const prisma = require("../db");
const { sUnit, sStudent, sStudentQuery } = require("../serializers");
const { requireAuth, requireStudent } = require("../auth");
const { summarise } = require("../attendance");
const { localDate } = require("../clock");
const { notifyAdmins } = require("../notify");

router.use(requireAuth, requireStudent);

// 70+ Distinction, 60-69 Merit, 50-59 Pass, below 50 Fail. Must match the same
// boundaries in routes/assessments.js and the client.
const bandOf = (pct) => (pct == null ? null : pct >= 70 ? "Distinction" : pct >= 60 ? "Merit" : pct >= 50 ? "Pass" : "Fail");
// Clamped 0–100, matching the admin gradebook: an historic mark above its
// assessment maximum would otherwise show the student a percentage over 100.
const pctOf = (marks, max) => (max > 0 ? Math.min(100, Math.max(0, Math.round((marks / max) * 1000) / 10)) : null);
const str = (v) => (typeof v === "string" ? v.trim() : "");

// GET /api/student/me — the signed-in student's own profile.
router.get("/me", async (req, res) => {
  const student = await prisma.student.findUnique({ where: { id: req.user.id }, include: { enrolments: { select: { unitId: true } } } });
  if (!student) return res.status(404).json({ error: "Student not found" });
  res.json(sStudent(student));
});

// GET /api/student/me/attendance — current vs previous units by each unit's last
// session date, with per-unit and current-overall percentages. Mirrors the admin
// per-student breakdown but locked to this student.
router.get("/me/attendance", async (req, res) => {
  const sid = req.user.id;
  const student = await prisma.student.findUnique({ where: { id: sid }, include: { enrolments: { select: { unitId: true } } } });
  if (!student) return res.status(404).json({ error: "Student not found" });
  const enrolledIds = student.enrolments.map((e) => e.unitId);
  const safeIds = enrolledIds.length ? enrolledIds : ["__none__"];

  const [units, marks, sessions] = await Promise.all([
    prisma.unit.findMany({ where: { id: { in: safeIds } } }),
    prisma.attendanceMark.findMany({ where: { studentId: sid }, select: { status: true, sessionId: true } }),
    prisma.hndSession.findMany({ where: { unitId: { in: safeIds } }, select: { id: true, unitId: true, date: true } }),
  ]);

  const today = localDate();
  const endByUnit = new Map();
  const sessMod = new Map();
  for (const s of sessions) { sessMod.set(s.id, s.unitId); const cur = endByUnit.get(s.unitId); if (!cur || s.date > cur) endByUnit.set(s.unitId, s.date); }
  const marksByUnit = new Map();
  for (const m of marks) { const mid = sessMod.get(m.sessionId); if (!mid) continue; if (!marksByUnit.has(mid)) marksByUnit.set(mid, []); marksByUnit.get(mid).push(m); }

  // A unit is FINISHED when its teaching window has passed. The window (Unit.endDate)
  // is what staff see on the Registers tab, so both sides now agree; the last-session
  // date is only a fallback for units nobody has scheduled yet. Using the session date
  // alone meant a unit whose registers were generated a term at a time dropped out of
  // a student's current attendance months before staff considered it over.
  const rowFor = (mod) => {
    const lastSession = endByUnit.get(mod.id) || null;
    const endDate = mod.endDate || lastSession;
    return {
      unit: sUnit(mod),
      summary: summarise(marksByUnit.get(mod.id) || []),
      endDate, lastSessionDate: lastSession,
      finished: !!(endDate && endDate < today),
    };
  };
  const rows = units.map(rowFor);
  const current = rows.filter((r) => !r.finished).sort((a, b) => (a.endDate || "9999").localeCompare(b.endDate || "9999"));
  const previous = rows.filter((r) => r.finished).sort((a, b) => (b.endDate || "").localeCompare(a.endDate || ""));
  const currentOverall = summarise(current.flatMap((r) => marksByUnit.get(r.unit.id) || []));

  // Back-compat: the Course→Unit rename renamed `module`→`unit` and `modules`→`units`
  // in this response. Older installed app builds still read the OLD keys, so we send
  // BOTH — new builds use unit/units, old installed builds keep working (no reinstall).
  const alias = (r) => ({ ...r, module: r.unit });
  res.json({
    current: { units: current.map(alias), modules: current.map(alias), overall: currentOverall },
    previous: previous.map(alias),
  });
});

// GET /api/student/me/assessments — this student's assessments, marks, grades, average.
router.get("/me/assessments", async (req, res) => {
  const student = await prisma.student.findUnique({ where: { id: req.user.id }, include: { enrolments: { select: { unitId: true } } } });
  if (!student) return res.status(404).json({ error: "Student not found" });
  const unitIds = student.enrolments.map((e) => e.unitId);
  const assessments = await prisma.assessment.findMany({
    where: { unitId: { in: unitIds.length ? unitIds : ["__none__"] } },
    include: { unit: { select: { code: true, name: true } } },
    orderBy: [{ unitId: "asc" }, { createdAt: "asc" }],
  });
  const grades = await prisma.assessmentGrade.findMany({ where: { studentId: student.id } });
  const gMap = new Map(grades.map((g) => [g.assessmentId, g]));
  let sum = 0, n = 0;
  const items = assessments.map((a) => {
    const g = gMap.get(a.id);
    const pct = g ? pctOf(g.marks, a.maxMarks) : null;
    if (pct != null) { sum += pct; n++; }
    return { id: a.id, title: a.title, type: a.type, maxMarks: a.maxMarks, weight: a.weight, dueDate: a.dueDate, unitCode: a.unit.code, unitName: a.unit.name, unitId: a.unitId, moduleCode: a.unit.code, moduleName: a.unit.name, moduleId: a.unitId, marks: g ? g.marks : null, feedback: g ? g.feedback : "", pct, grade: bandOf(pct) };
  });
  res.json({
    assessments: items, count: items.length, graded: n,
    averagePct: n ? Math.round((sum / n) * 10) / 10 : null,
    averageGrade: n ? bandOf(Math.round((sum / n) * 10) / 10) : null,
  });
});

// GET /api/student/me/timetable — the weekly timetable relevant to this student.
//
// A student's course/year/term is derived from the units they are ENROLLED on (a
// cohort is set for very few students, so enrolments are the reliable signal). Their
// timetable is every slot whose (courseId, year, termNumber) matches one of those
// enrolled units — which includes the workshop/support rows that share the same scope
// but are not units. Grouped by stage so the app can show one course/year/term block.
router.get("/me/timetable", async (req, res) => {
  const student = await prisma.student.findUnique({
    where: { id: req.user.id },
    include: { enrolments: { include: { unit: { select: { courseId: true, year: true, termNumber: true } } } } },
  });
  if (!student) return res.status(404).json({ error: "Student not found" });

  // The distinct (course, year, term) stages the student's units place them in.
  const stageKeys = new Set();
  for (const e of student.enrolments) {
    const u = e.unit;
    if (u?.courseId != null && u.year != null && u.termNumber != null) stageKeys.add(`${u.courseId}|${u.year}|${u.termNumber}`);
  }
  if (!stageKeys.size) return res.json({ stages: [] });

  const or = [...stageKeys].map((k) => { const [courseId, year, termNumber] = k.split("|"); return { courseId, year: Number(year), termNumber: Number(termNumber) }; });
  const slots = await prisma.timetableSlot.findMany({
    where: { OR: or },
    include: { course: { select: { name: true, colour: true } }, unit: { select: { code: true } } },
    orderBy: [{ day: "asc" }, { startTime: "asc" }],
  });

  // Group into one block per (course, year, term).
  const byStage = new Map();
  for (const s of slots) {
    const key = `${s.courseId}|${s.year}|${s.termNumber}`;
    if (!byStage.has(key)) byStage.set(key, { courseId: s.courseId, courseName: s.course?.name || "", colour: s.course?.colour || null, year: s.year, termNumber: s.termNumber, rows: [] });
    byStage.get(key).rows.push({ id: s.id, day: s.day, start: s.startTime, end: s.endTime, title: s.title, lecturer: s.lecturer || "", room: s.room || "", unitCode: s.unit?.code || null });
  }
  res.json({ stages: [...byStage.values()].sort((a, b) => (a.year - b.year) || (a.termNumber - b.termNumber)) });
});

// GET /api/student/me/queries — this student's own queries and any admin replies.
router.get("/me/queries", async (req, res) => {
  const rows = await prisma.studentQuery.findMany({ where: { studentId: req.user.id }, orderBy: { createdAt: "desc" } });
  res.json(rows.map(sStudentQuery));
});

// GET /api/student/me/reviews — the progress reviews lecturers have written about
// this student. Read-only: writing lives on /api/student-reviews, which is staff-only.
//
// It belongs HERE rather than on that router because requireAuth deliberately blocks a
// student token from every router except /api/student — a single choke point that keeps
// students out of all staff data regardless of any individual route's own guards.
// Widening that allowlist to serve one endpoint would trade a strong invariant for a
// convenience, so the endpoint moved to the student router instead.
router.get("/me/reviews", async (req, res) => {
  const rows = await prisma.studentReview.findMany({
    where: { studentId: req.user.id },
    include: { unit: true, staff: { select: { name: true } } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  res.json(rows.map((r) => ({
    id: r.id,
    unitId: r.unitId,
    unit: r.unit ? { id: r.unit.id, code: r.unit.code, name: r.unit.name } : null,
    // The author's name is stored on the row, so a review still says who wrote it
    // after that lecturer leaves the college.
    staffName: r.staffName || r.staff?.name || "",
    date: r.date,
    progress: r.progress,
    concerns: (() => { try { return JSON.parse(r.concerns || "[]"); } catch { return []; } })(),
    summary: r.summary,
    agreedActions: r.agreedActions,
    followUp: r.followUp,
    followUpDate: r.followUpDate,
    createdAt: r.createdAt,
  })));
});

// POST /api/student/me/query — the student sends a query to the college. Admins pick
// it up and reply in the Student Queries tab; the reply comes back here to the student.
router.post("/me/query", async (req, res) => {
  const message = str(req.body?.message);
  const subject = str(req.body?.subject) || "Student query";
  if (message.length < 3) return res.status(400).json({ error: "Please write your query" });
  if (message.length > 4000) return res.status(400).json({ error: "Query is too long" });
  // Cap the subject too — message was bounded but subject wasn't, so a student could
  // push a 1MB blob into StudentQuery.subject and into every admin's notification row.
  if (subject.length > 200) return res.status(400).json({ error: "Subject is too long (200 characters maximum)" });

  const query = await prisma.studentQuery.create({
    data: { studentId: req.user.id, subject, message, status: "open" },
  });
  notifyAdmins({ type: "info", message: `New query from student ${req.user.name}: ${subject}`, link: "studentqueries" });
  res.status(201).json(sStudentQuery(query));
});

module.exports = router;
