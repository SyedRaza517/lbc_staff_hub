// Assessments & grades (a gradebook for HND units).
// Reads require a signed-in user; every mutation is admin-only.
const router = require("express").Router();
const prisma = require("../db");
const { sAssessment, sGrade, sStudent, sUnit } = require("../serializers");
const { requireAuth, requireAdmin, requirePage } = require("../auth");
const { isRealDate } = require("../validate");

// DEF-01: the gradebook is admin-only (student marks are sensitive; no staff/mobile
// flow reads them). Guard every route, reads included, against non-admin tokens.
router.use(requireAuth, requirePage("assessments"));

const TYPES = ["Assignment", "Exam", "Presentation", "Project", "Portfolio"];
const str = (v) => (typeof v === "string" ? v.trim() : "");
const isInt = (v) => Number.isInteger(v);
// HND-style banding of a percentage.
const bandOf = (pct) => (pct == null ? null : pct >= 70 ? "Distinction" : pct >= 60 ? "Merit" : pct >= 40 ? "Pass" : "Fail");
const pctOf = (marks, max) => (max > 0 ? Math.round((marks / max) * 1000) / 10 : null);

/* ============================== assessments ============================== */

// GET /assessments?unitId=  — assessments with graded count + average mark.
router.get("/", requireAuth, async (req, res) => {
  const unitId = str(req.query?.unitId);
  const rows = await prisma.assessment.findMany({
    where: unitId ? { unitId } : undefined,
    orderBy: [{ unitId: "asc" }, { createdAt: "asc" }],
    include: { unit: { select: { code: true, name: true } }, _count: { select: { grades: true } } },
  });
  // Average mark per assessment, in one grouped query.
  const agg = await prisma.assessmentGrade.groupBy({ by: ["assessmentId"], _avg: { marks: true } });
  const avgById = Object.fromEntries(agg.map((a) => [a.assessmentId, a._avg.marks]));
  res.json(rows.map((a) => {
    const avgMarks = avgById[a.id] != null ? Math.round(avgById[a.id] * 10) / 10 : null;
    return { ...sAssessment(a), avgMarks, avgPct: avgMarks != null ? pctOf(avgMarks, a.maxMarks) : null };
  }));
});

async function validateAssessment(body, partial) {
  const data = {};
  const need = (k) => !partial || body?.[k] !== undefined;
  if (need("unitId")) {
    const unitId = str(body?.unitId);
    if (!unitId) return { error: "Unit is required" };
    const m = await prisma.unit.findUnique({ where: { id: unitId } });
    if (!m) return { error: "Unknown unit" };
    data.unitId = unitId;
  }
  if (need("title")) {
    const title = str(body?.title);
    if (!title) return { error: "Assessment title is required" };
    data.title = title;
  }
  if (body?.type !== undefined) {
    const type = str(body.type);
    if (!TYPES.includes(type)) return { error: `Type must be one of: ${TYPES.join(", ")}` };
    data.type = type;
  }
  if (body?.maxMarks !== undefined) {
    const max = Number(body.maxMarks);
    if (!isInt(max) || max < 1 || max > 1000) return { error: "Max marks must be a whole number between 1 and 1000" };
    data.maxMarks = max;
  }
  if (body?.weight !== undefined) {
    const w = Number(body.weight);
    if (!isInt(w) || w < 0 || w > 100) return { error: "Weight must be a whole number between 0 and 100" };
    data.weight = w;
  }
  if (body?.dueDate !== undefined) {
    const d = str(body.dueDate);
    if (d && !isRealDate(d)) return { error: "Due date must be a valid date (YYYY-MM-DD)" };
    data.dueDate = d || null;
  }
  return { data };
}

router.post("/", requireAuth, requireAdmin, async (req, res) => {
  const v = await validateAssessment(req.body, false);
  if (v.error) return res.status(400).json({ error: v.error });
  const a = await prisma.assessment.create({ data: { type: "Assignment", maxMarks: 100, ...v.data }, include: { unit: { select: { code: true, name: true } }, _count: { select: { grades: true } } } });
  res.status(201).json(sAssessment(a));
});

router.put("/:id", requireAuth, requireAdmin, async (req, res) => {
  const existing = await prisma.assessment.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Assessment not found" });
  const v = await validateAssessment(req.body, true);
  if (v.error) return res.status(400).json({ error: v.error });
  const a = await prisma.assessment.update({ where: { id: existing.id }, data: v.data, include: { unit: { select: { code: true, name: true } }, _count: { select: { grades: true } } } });
  res.json(sAssessment(a));
});

router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  try { await prisma.assessment.delete({ where: { id: req.params.id } }); res.json({ ok: true }); }
  catch (_e) { res.status(404).json({ error: "Assessment not found" }); }
});

// GET /assessments/grades?courseId=&unitId=&studentId=
// A flat, filterable list of individual grade records for the record-level CRUD
// view. Capped so an unfiltered call can't return the entire gradebook at once.
router.get("/grades", requireAuth, async (req, res) => {
  const courseId = str(req.query?.courseId);
  const unitId = str(req.query?.unitId);
  const studentId = str(req.query?.studentId);
  const where = {};
  if (studentId) where.studentId = studentId;
  if (unitId) where.assessment = { unitId };
  else if (courseId) where.assessment = { is: { unit: { is: { courseId } } } };
  // DEF-06: report the true total and whether the result was truncated, so the UI
  // can tell the user to narrow the filter instead of silently hiding records.
  const LIMIT = 2000;
  const [total, rows] = await Promise.all([
    prisma.assessmentGrade.count({ where }),
    prisma.assessmentGrade.findMany({
      where,
      include: { student: true, assessment: { include: { unit: { select: { code: true, name: true, courseId: true } } } } },
      orderBy: { gradedAt: "desc" },
      take: LIMIT,
    }),
  ]);
  res.json({
    total, returned: rows.length, capped: total > rows.length, limit: LIMIT,
    records: rows.map((g) => {
      const pct = pctOf(g.marks, g.assessment.maxMarks);
      return {
        id: g.id, assessmentId: g.assessmentId, studentId: g.studentId, marks: g.marks, pct, grade: bandOf(pct),
        student: { id: g.student.id, name: `${g.student.firstName} ${g.student.lastName}`, studentRef: g.student.studentRef, initials: g.student.initials, colour: g.student.colour },
        assessment: { id: g.assessment.id, title: g.assessment.title, type: g.assessment.type, maxMarks: g.assessment.maxMarks },
        unit: { id: g.assessment.unitId, code: g.assessment.unit.code, name: g.assessment.unit.name, courseId: g.assessment.unit.courseId },
      };
    }),
  });
});

/* ============================== grade entry ============================== */

// GET /assessments/:id/grades — every enrolled student with their mark (if any).
router.get("/:id/grades", requireAuth, async (req, res) => {
  const a = await prisma.assessment.findUnique({ where: { id: req.params.id }, include: { unit: true, grades: true } });
  if (!a) return res.status(404).json({ error: "Assessment not found" });
  const enrolments = await prisma.enrolment.findMany({ where: { unitId: a.unitId }, include: { student: true } });
  const byStudent = new Map(a.grades.map((g) => [g.studentId, g]));
  // Keep a graded student who has since been un-enrolled.
  const extraIds = a.grades.filter((g) => !enrolments.some((e) => e.studentId === g.studentId)).map((g) => g.studentId);
  const extra = extraIds.length ? await prisma.student.findMany({ where: { id: { in: extraIds } } }) : [];
  const students = [...enrolments.map((e) => e.student), ...extra].sort((x, y) => x.lastName.localeCompare(y.lastName) || x.firstName.localeCompare(y.firstName));
  res.json({
    assessment: sAssessment(a), unit: sUnit(a.unit),
    rows: students.map((s) => {
      const g = byStudent.get(s.id);
      const pct = g ? pctOf(g.marks, a.maxMarks) : null;
      return { student: sStudent(s), marks: g ? g.marks : null, grade: bandOf(pct), pct, enrolled: enrolments.some((e) => e.studentId === s.id) };
    }),
  });
});

// PUT /assessments/:id/grades  — bulk upsert. A row with marks null/"" clears it.
router.put("/:id/grades", requireAuth, requireAdmin, async (req, res) => {
  const a = await prisma.assessment.findUnique({ where: { id: req.params.id } });
  if (!a) return res.status(404).json({ error: "Assessment not found" });
  const grades = Array.isArray(req.body?.grades) ? req.body.grades : null;
  if (!grades) return res.status(400).json({ error: "grades array required" });

  const rows = [];
  for (const g of grades) {
    const studentId = str(g?.studentId);
    if (!studentId) return res.status(400).json({ error: "Each grade needs a studentId" });
    let marks = g?.marks;
    if (marks === "" || marks == null) { rows.push({ studentId, marks: null }); continue; }
    marks = Number(marks);
    if (!isInt(marks) || marks < 0 || marks > a.maxMarks) return res.status(400).json({ error: `Marks must be a whole number between 0 and ${a.maxMarks}` });
    rows.push({ studentId, marks });
  }
  const ids = rows.map((r) => r.studentId);
  if (ids.length) {
    const found = await prisma.student.count({ where: { id: { in: ids } } });
    if (found !== new Set(ids).size) return res.status(400).json({ error: "One or more students do not exist" });
  }
  const gradedBy = req.user?.name || null;
  await prisma.$transaction(rows.map((r) => (
    r.marks === null
      ? prisma.assessmentGrade.deleteMany({ where: { assessmentId: a.id, studentId: r.studentId } })
      : prisma.assessmentGrade.upsert({
          where: { assessmentId_studentId: { assessmentId: a.id, studentId: r.studentId } },
          create: { assessmentId: a.id, studentId: r.studentId, marks: r.marks, gradedBy },
          update: { marks: r.marks, gradedBy, gradedAt: new Date() },
        })
  )));
  const saved = await prisma.assessmentGrade.findMany({ where: { assessmentId: a.id } });
  res.json({ ok: true, saved: saved.length });
});

/* ============================== analytics ============================== */

// GET /assessments/overview — per-unit averages + distribution + overall.
router.get("/overview", requireAuth, async (_req, res) => {
  const [assessments, units, allGrades] = await Promise.all([
    prisma.assessment.findMany({ select: { id: true, unitId: true, maxMarks: true } }),
    prisma.unit.findMany({ orderBy: { code: "asc" }, include: { _count: { select: { enrolments: true, assessments: true } } } }),
    prisma.assessmentGrade.findMany({ select: { assessmentId: true, marks: true } }),
  ]);
  const aMap = new Map(assessments.map((a) => [a.id, a]));
  const perUnit = new Map(units.map((m) => [m.id, { sum: 0, n: 0, dist: { Distinction: 0, Merit: 0, Pass: 0, Fail: 0 } }]));
  let sumAll = 0, nAll = 0, passAll = 0;
  const distAll = { Distinction: 0, Merit: 0, Pass: 0, Fail: 0 };
  for (const g of allGrades) {
    const a = aMap.get(g.assessmentId); if (!a) continue;
    const pct = pctOf(g.marks, a.maxMarks); if (pct == null) continue;
    const band = bandOf(pct);
    const pm = perUnit.get(a.unitId); if (pm) { pm.sum += pct; pm.n++; pm.dist[band]++; }
    sumAll += pct; nAll++; distAll[band]++; if (pct >= 40) passAll++;
  }
  const unitsOut = units.map((m) => {
    const pm = perUnit.get(m.id);
    return {
      id: m.id, code: m.code, name: m.name,
      students: m._count.enrolments, assessmentCount: m._count.assessments,
      gradedCount: pm.n, avgPct: pm.n ? Math.round((pm.sum / pm.n) * 10) / 10 : null, dist: pm.dist,
    };
  });
  res.json({
    overall: {
      assessments: assessments.length, gradedSubmissions: nAll,
      avgPct: nAll ? Math.round((sumAll / nAll) * 10) / 10 : null,
      passRate: nAll ? Math.round((passAll / nAll) * 1000) / 10 : null,
      dist: distAll,
    },
    units: unitsOut,
  });
});

// GET /assessments/student/:id — one student's assessments, marks, grades + average.
router.get("/student/:id", requireAuth, async (req, res) => {
  const student = await prisma.student.findUnique({ where: { id: req.params.id }, include: { enrolments: { select: { unitId: true } } } });
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
    return { id: a.id, title: a.title, type: a.type, maxMarks: a.maxMarks, weight: a.weight, dueDate: a.dueDate, unitCode: a.unit.code, unitName: a.unit.name, unitId: a.unitId, marks: g ? g.marks : null, pct, grade: bandOf(pct) };
  });
  res.json({
    student: sStudent(student),
    assessments: items,
    count: items.length, graded: n,
    averagePct: n ? Math.round((sum / n) * 10) / 10 : null,
    averageGrade: n ? bandOf(Math.round((sum / n) * 10) / 10) : null,
  });
});

// GET /assessments/exec-summary — college-wide pass statistics for the Executive
// Dashboard. A student "passes" if their AVERAGE graded mark is 40%+. Results are
// grouped by cohort (the "course"), plus per-course pass-rate. Heavy per-student
// aggregation done here (server-side) so the client never fetches 100s of students.
router.get("/exec-summary", requireAuth, async (req, res) => {
  const [students, assessments, grades, cohorts, courseList, unitList, enrolments] = await Promise.all([
    prisma.student.findMany({ select: { id: true, cohortId: true } }),
    prisma.assessment.findMany({ select: { id: true, maxMarks: true, unitId: true } }),
    prisma.assessmentGrade.findMany({ select: { studentId: true, assessmentId: true, marks: true } }),
    prisma.cohort.findMany({ select: { id: true, name: true, courseId: true } }),
    prisma.course.findMany({ select: { id: true, name: true } }),
    prisma.unit.findMany({ select: { id: true, courseId: true } }),
    prisma.enrolment.findMany({ select: { studentId: true, unitId: true } }),
  ]);
  // How many assessments belong to each course (via unit → course).
  const unitCourse = new Map(unitList.map((u) => [u.id, u.courseId || null]));
  const assessByCourse = new Map();
  for (const a of assessments) {
    const cid = unitCourse.get(a.unitId) || "__none__";
    assessByCourse.set(cid, (assessByCourse.get(cid) || 0) + 1);
  }
  // Each student's course from their ENROLLED UNITS (the course whose units they're
  // on most). This is how students are actually put on a course, so it's the primary
  // signal — a cohort link is only a fallback. Fixes students showing "Unassigned".
  const stuCourseCount = new Map(); // studentId -> Map(courseId -> unit count)
  for (const e of enrolments) {
    const cid = unitCourse.get(e.unitId); if (!cid) continue;
    if (!stuCourseCount.has(e.studentId)) stuCourseCount.set(e.studentId, new Map());
    const m = stuCourseCount.get(e.studentId); m.set(cid, (m.get(cid) || 0) + 1);
  }
  const studentCourse = new Map();
  for (const [sid, m] of stuCourseCount) {
    let best = null, n = 0; for (const [cid, c] of m) if (c > n) { best = cid; n = c; }
    if (best) studentCourse.set(sid, best);
  }
  const aMax = new Map(assessments.map((a) => [a.id, a.maxMarks]));
  // Average graded % per student.
  const perStudent = new Map();
  for (const g of grades) {
    const max = aMax.get(g.assessmentId); if (!max) continue;
    const pct = pctOf(g.marks, max); if (pct == null) continue;
    const s = perStudent.get(g.studentId) || { sum: 0, n: 0 };
    s.sum += pct; s.n += 1; perStudent.set(g.studentId, s);
  }
  // Map a student to their Course via their cohort (student → cohort → course).
  // Students with no cohort, or a cohort with no course, are "Unassigned".
  const cohortCourse = new Map(cohorts.map((c) => [c.id, c.courseId || null]));
  // Seed a bucket for EVERY course up front, so a course with no students yet
  // still appears on the dashboard (that was the missing piece).
  const byCourse = new Map();
  for (const c of courseList) byCourse.set(c.id, { code: c.name, count: 0, passed: 0, graded: 0 });
  byCourse.set("__none__", { code: "Unassigned", count: 0, passed: 0, graded: 0 });
  let totalPassed = 0, totalGraded = 0;
  for (const st of students) {
    const key = studentCourse.get(st.id) || (st.cohortId && cohortCourse.get(st.cohortId)) || "__none__";
    const b = byCourse.get(key) || byCourse.get("__none__");
    b.count += 1;
    const g = perStudent.get(st.id);
    if (g && g.n > 0) {
      b.graded += 1; totalGraded += 1;
      if (g.sum / g.n >= 40) { b.passed += 1; totalPassed += 1; }
    }
  }
  const courses = [...byCourse.entries()]
    .map(([cid, b]) => ({
      courseId: cid, code: b.code,
      studentCount: b.count, studentsPassed: b.passed, graded: b.graded,
      assessments: assessByCourse.get(cid) || 0,
      passRate: b.count ? Math.round((b.passed / b.count) * 1000) / 10 : 0,
    }))
    .filter((c) => c.courseId !== "__none__" || c.studentCount > 0) // hide empty "Unassigned"
    .sort((a, b) => b.studentCount - a.studentCount);
  res.json({
    totals: {
      students: students.length,
      studentsPassed: totalPassed,
      graded: totalGraded,
      passRate: students.length ? Math.round((totalPassed / students.length) * 1000) / 10 : 0,
      assessments: assessments.length,
      courses: courseList.length,
    },
    courses,
  });
});

module.exports = router;
module.exports.TYPES = TYPES;
