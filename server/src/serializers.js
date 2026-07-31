// Convert DB rows -> the shape the React client expects.
// NOTE: totpSecret is deliberately absent — only the enrolment endpoint ever
// returns it, and only to the person enrolling.
const sStaff = (s) => ({
  id: s.id, name: s.name, role: s.jobTitle, dept: s.dept, email: s.email,
  site: s.site ?? null,
  allowance: s.allowance, initials: s.initials, colour: s.colour, accountRole: s.accountRole,
  mustChangePassword: s.mustChangePassword ?? false,
  totpEnabled: s.totpEnabled ?? false,
  totpRequired: s.mustSetupTotp ?? false,
  // True while an admin-created account is waiting for the person to set their
  // own password from the invitation email. Such an account cannot be signed into.
  pendingActivation: s.pendingActivation ?? false,
  // --- Admin access control ---
  isSuperAdmin: s.isSuperAdmin ?? false,
  // Parsed to an array of allowed page keys, or null = "never configured" (full
  // access). Bad/corrupt JSON is treated as null rather than throwing.
  adminPages: parseAdminPages(s.adminPages),
});

// NULL → null (unconfigured, full access). Valid JSON array → the array. Anything
// else (including '[]') → as parsed; only unparseable text falls back to null.
function parseAdminPages(raw) {
  if (raw == null) return null;
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a : null; }
  catch (_) { return null; }
}

const sSignup = (r) => ({
  id: r.id, kind: r.kind || "staff", studentId: r.studentId ?? null, collegeId: r.collegeId ?? null,
  name: r.name, email: r.email, role: r.jobTitle, dept: r.dept, site: r.site ?? null,
  status: r.status, note: r.note, decidedBy: r.decidedBy, decidedAt: r.decidedAt,
  requestedAt: r.createdAt,
});
const sNotification = (n) => ({ id: n.id, type: n.type, message: n.message, link: n.link, read: n.read, at: n.createdAt });
const sCheckin = (c) => ({ id: c.id, staffId: c.staffId, date: c.date, in: c.timeIn, out: c.timeOut, summary: c.summary, site: c.site ?? null });
const sLeave = (l) => ({
  id: l.id, staffId: l.staffId, type: l.type, start: l.start, end: l.end, days: l.days, reason: l.reason,
  status: l.status, requestedAt: l.requestedAt, decidedBy: l.decidedBy, decidedAt: l.decidedAt, note: l.note,
});
const sDoc = (d) => ({ id: d.id, name: d.name, type: d.type, date: d.date, scope: d.scope, assignedTo: d.assignedToId });
const sAdj = (a) => ({ id: a.id, staffId: a.staffId, days: a.days, note: a.note, date: a.date });

/* ---------- HND attendance registers ---------- */
const sSemester = (s) => ({ id: s.id, name: s.name, start: s.start, end: s.end });
const sCourse = (p) => ({
  id: p.id, name: p.name, colour: p.colour,
  // Present only when the query asked Prisma to count relations.
  ...(p._count ? { unitCount: p._count.units, cohortCount: p._count.cohorts } : {}),
});
const sCohort = (c) => ({ id: c.id, name: c.name, courseId: c.courseId, startDate: c.startDate ?? null, createdAt: c.createdAt });
const sTerm = (t) => ({ id: t.id, cohortId: t.cohortId, year: t.year, index: t.index, name: t.name, start: t.start, end: t.end });
const sUnit = (m) => ({
  id: m.id, code: m.code, unitNumber: m.unitNumber ?? "", name: m.name, tutor: m.tutor, courseId: m.courseId ?? null,
  // Where the unit sits in the course structure ("Year 1 · Term 2"), null when it
  // has not been classified. Separate from termId, which is a dated teaching term.
  year: m.year ?? null, termNumber: m.termNumber ?? null,
  // The teaching window, which decides whether the unit is running, finished or
  // still to come. Set in Staff Hub; never overwritten by the Moodle sync.
  startDate: m.startDate ?? null, endDate: m.endDate ?? null,
  cohortId: m.cohortId ?? null, termId: m.termId ?? null,
  // Present only when the query asked Prisma to count relations.
  ...(m._count ? { sessionCount: m._count.sessions, studentCount: m._count.enrolments } : {}),
});
const sStudent = (s) => ({
  id: s.id, firstName: s.firstName, lastName: s.lastName, name: `${s.firstName} ${s.lastName}`,
  studentRef: s.studentRef, email: s.email, initials: s.initials, colour: s.colour, active: s.active,
  cohortId: s.cohortId ?? null,
  ...(s.enrolments ? { unitIds: s.enrolments.map((e) => e.unitId) } : {}),
});
const sSession = (x) => ({
  id: x.id, unitId: x.unitId, date: x.date, start: x.startTime, end: x.endTime,
  description: x.description, audience: x.audience, kind: x.kind ?? "",
  ...(x._count ? { markedCount: x._count.marks } : {}),
});
const sMark = (m) => ({ id: m.id, sessionId: m.sessionId, studentId: m.studentId, status: m.status, remark: m.remark, takenBy: m.takenBy, takenAt: m.takenAt });
const sInteraction = (i) => ({
  id: i.id, studentId: i.studentId, date: i.date, time: i.time, queryType: i.queryType,
  summary: i.summary, followUpActions: i.followUpActions, followUpRequired: i.followUpRequired,
  tutor: i.tutor, loggedBy: i.loggedBy, createdAt: i.createdAt,
  // When the query includes the student, surface the fields the log table shows.
  ...(i.student ? { student: { id: i.student.id, name: `${i.student.firstName} ${i.student.lastName}`, studentRef: i.student.studentRef, initials: i.student.initials, colour: i.student.colour } } : {}),
});

const sAssessment = (a) => ({
  id: a.id, unitId: a.unitId, title: a.title, type: a.type, maxMarks: a.maxMarks,
  weight: a.weight, dueDate: a.dueDate, createdAt: a.createdAt,
  ...(a._count ? { gradedCount: a._count.grades } : {}),
  ...(a.unit ? { unitCode: a.unit.code, unitName: a.unit.name } : {}),
});
const sGrade = (g) => ({
  id: g.id, assessmentId: g.assessmentId, studentId: g.studentId, marks: g.marks,
  feedback: g.feedback, gradedBy: g.gradedBy, gradedAt: g.gradedAt,
  // Where the mark came from ("manual" = typed here, "moodle" = imported) and the
  // VLE's own dates. Exposed so staff can see provenance, and so the sync's promise
  // that it never overwrites hand-entered marks is verifiable from outside.
  source: g.source ?? "manual", submittedAt: g.submittedAt ?? null, gradedOn: g.gradedOn ?? null,
});

/* ---------- Timesheets ---------- */
const sTimesheet = (t) => ({
  id: t.id, staffId: t.staffId, date: t.date, start: t.startTime, end: t.endTime,
  minutes: t.minutes, hours: Math.round((t.minutes / 60) * 100) / 100,
  mode: t.mode, title: t.title, unitId: t.unitId ?? null, note: t.note,
  status: t.status, submittedAt: t.submittedAt, createdAt: t.createdAt,
  reviewNote: t.reviewNote ?? null, reviewedBy: t.reviewedBy ?? null, reviewedAt: t.reviewedAt ?? null,
  ...(t.staff ? { staffName: t.staff.name, staffDept: t.staff.dept, staffInitials: t.staff.initials, staffColour: t.staff.colour } : {}),
});

// A student query + its (optional) admin response. Includes a light student summary
// for the admin list.
const sStudentQuery = (q) => ({
  id: q.id, studentId: q.studentId,
  subject: q.subject || "", message: q.message,
  status: q.status, response: q.response || "",
  respondedBy: q.respondedBy ?? null, respondedAt: q.respondedAt ?? null,
  createdAt: q.createdAt,
  ...(q.student ? { studentName: q.student.name || `${q.student.firstName} ${q.student.lastName}`, studentRef: q.student.studentRef, studentEmail: q.student.email, studentInitials: q.student.initials, studentColour: q.student.colour } : {}),
});

module.exports = { sStaff, sSignup, sCheckin, sLeave, sDoc, sAdj, sNotification, sSemester, sCourse, sCohort, sTerm, sUnit, sStudent, sSession, sMark, sInteraction, sAssessment, sGrade, sTimesheet, sStudentQuery };
