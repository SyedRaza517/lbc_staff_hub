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

const bandOf = (pct) => (pct == null ? null : pct >= 70 ? "Distinction" : pct >= 60 ? "Merit" : pct >= 40 ? "Pass" : "Fail");
const pctOf = (marks, max) => (max > 0 ? Math.round((marks / max) * 1000) / 10 : null);
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

  const rowFor = (mod) => { const endDate = endByUnit.get(mod.id) || null; return { unit: sUnit(mod), summary: summarise(marksByUnit.get(mod.id) || []), endDate, finished: !!(endDate && endDate < today) }; };
  const rows = units.map(rowFor);
  const current = rows.filter((r) => !r.finished).sort((a, b) => (a.endDate || "9999").localeCompare(b.endDate || "9999"));
  const previous = rows.filter((r) => r.finished).sort((a, b) => (b.endDate || "").localeCompare(a.endDate || ""));
  const currentOverall = summarise(current.flatMap((r) => marksByUnit.get(r.unit.id) || []));

  res.json({ current: { units: current, overall: currentOverall }, previous });
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
    return { id: a.id, title: a.title, type: a.type, maxMarks: a.maxMarks, weight: a.weight, dueDate: a.dueDate, unitCode: a.unit.code, unitName: a.unit.name, unitId: a.unitId, marks: g ? g.marks : null, feedback: g ? g.feedback : "", pct, grade: bandOf(pct) };
  });
  res.json({
    assessments: items, count: items.length, graded: n,
    averagePct: n ? Math.round((sum / n) * 10) / 10 : null,
    averageGrade: n ? bandOf(Math.round((sum / n) * 10) / 10) : null,
  });
});

// GET /api/student/me/queries — this student's own queries and any admin replies.
router.get("/me/queries", async (req, res) => {
  const rows = await prisma.studentQuery.findMany({ where: { studentId: req.user.id }, orderBy: { createdAt: "desc" } });
  res.json(rows.map(sStudentQuery));
});

// POST /api/student/me/query — the student sends a query to the college. Admins pick
// it up and reply in the Student Queries tab; the reply comes back here to the student.
router.post("/me/query", async (req, res) => {
  const message = str(req.body?.message);
  const subject = str(req.body?.subject) || "Student query";
  if (message.length < 3) return res.status(400).json({ error: "Please write your query" });
  if (message.length > 4000) return res.status(400).json({ error: "Query is too long" });

  const query = await prisma.studentQuery.create({
    data: { studentId: req.user.id, subject, message, status: "open" },
  });
  notifyAdmins({ type: "info", message: `New query from student ${req.user.name}: ${subject}`, link: "studentqueries" });
  res.status(201).json(sStudentQuery(query));
});

module.exports = router;
