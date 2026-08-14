// Attendance Emails — an admin tool to recognise students by their attendance.
//
// The admin picks an attendance percentage RANGE (e.g. 90–100% for "good attendance"),
// reviews who falls in it, and sends them a personalised email. Attendance % is computed
// server-side with the same points model and "current enrolments only" rule as the
// attendance matrix (see attendance.js / routes/hnd.js), so the figure a student is
// emailed is trustworthy and never taken from the client.
//
// Gated on the "attendance-emails" admin page.
const router = require("express").Router();
const prisma = require("../db");
const { requireAuth, requirePage } = require("../auth");
const { summariseCounts } = require("../attendance");
const email = require("../email");

router.use(requireAuth, requirePage("attendance-emails"));

// Per-student P/L/E/A counts across the units the student is CURRENTLY enrolled on. The
// JOIN to Enrolment drops marks on units a student has since left, matching the matrix.
// No user input is interpolated, so the static SQL is safe.
const COUNTS_SQL = `
  SELECT am."studentId" sid,
    count(*) FILTER (WHERE am.status='P')::int p,
    count(*) FILTER (WHERE am.status='L')::int l,
    count(*) FILTER (WHERE am.status='E')::int e,
    count(*) FILTER (WHERE am.status='A')::int a
  FROM "AttendanceMark" am
  JOIN "HndSession" se ON se.id = am."sessionId"
  JOIN "Enrolment" en ON en."studentId" = am."studentId" AND en."unitId" = se."unitId"
  GROUP BY am."studentId"`;

async function studentsWithAttendance() {
  const [students, counts] = await Promise.all([
    prisma.student.findMany({
      where: { active: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      include: { cohort: { include: { course: { select: { name: true } } } } },
    }),
    prisma.$queryRawUnsafe(COUNTS_SQL),
  ]);
  const byId = new Map(counts.map((c) => [c.sid, c]));
  return students.map((s) => {
    const c = byId.get(s.id) || { p: 0, l: 0, e: 0, a: 0 };
    const sum = summariseCounts(c.p, c.l, c.e, c.a);
    return {
      id: s.id,
      firstName: s.firstName || "",
      lastName: s.lastName || "",
      name: [s.firstName, s.lastName].filter(Boolean).join(" "),
      email: s.email || "",
      studentRef: s.studentRef || "",
      course: s.cohort?.course?.name || "",
      cohort: s.cohort?.name || "",
      pct: sum.pct,      // 0..100, or null when the student has no marked sessions
      marked: sum.marked,
    };
  });
}

// GET /api/attendance-emails/students — every active student with their overall
// attendance %, email, course and cohort.
router.get("/students", async (_req, res) => {
  res.json(await studentsWithAttendance());
});

// Replace {firstName} {lastName} {name} {pct} {course} in a template.
function fillTemplate(t, vars) {
  return String(t).replace(/\{(firstName|lastName|name|pct|course)\}/g, (_, k) => (vars[k] == null ? "" : String(vars[k])));
}

// Wrap the admin's plain-text message in the branded LBC email shell (line breaks kept),
// with an optional attendance badge at the top.
function attendanceEmailHtml(bodyText, pct) {
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const bodyHtml = esc(bodyText).replace(/\n/g, "<br>");
  const badge = pct == null ? "" :
    `<div style="text-align:center;margin:0 0 22px"><span style="display:inline-block;padding:10px 22px;border-radius:999px;background:#ecfdf5;color:#047857;font-size:22px;font-weight:800;border:1px solid #a7f3d0">${esc(String(pct))}% attendance</span></div>`;
  return `<div style="margin:0;padding:24px;background:#eef1f6;font-family:'Segoe UI',Roboto,system-ui,-apple-system,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(15,23,42,.08)">
    <tr><td style="background:linear-gradient(135deg,#1a3a8f,#9e1b32);padding:24px 28px">
      <p style="margin:0;color:#ffffff;font-size:18px;font-weight:800">London Brookes College</p>
      <p style="margin:3px 0 0;color:rgba(255,255,255,.75);font-size:11px;font-weight:700;letter-spacing:.18em">STUDENT ATTENDANCE</p>
    </td></tr>
    <tr><td style="padding:28px">
      ${badge}
      <div style="font-size:14px;line-height:1.7;color:#334155">${bodyHtml}</div>
    </td></tr>
    <tr><td style="padding:16px 28px;background:#f8fafc;border-top:1px solid #e2e8f0">
      <p style="margin:0;font-size:11px;line-height:1.6;color:#94a3b8">London Brookes College &middot; 42 The Burroughs, Hendon, London NW4 4AP<br>info@londonbrookescollege.co.uk &middot; www.londonbrookescollege.co.uk</p>
    </td></tr>
  </table>
</div>`;
}

// POST /api/attendance-emails/send — send a personalised email to the given students.
// body: { studentIds: string[], subject: string, message: string }
// The {pct}/{course} placeholders are filled from freshly-recomputed attendance, never
// from the client, so a tampered request can't email a false figure.
router.post("/send", async (req, res) => {
  const b = req.body || {};
  const ids = Array.isArray(b.studentIds) ? b.studentIds.filter((x) => typeof x === "string") : [];
  const subjectTpl = String(b.subject || "").trim();
  const messageTpl = String(b.message || "").trim();
  if (!ids.length) return res.status(400).json({ error: "Select at least one student." });
  if (!subjectTpl || !messageTpl) return res.status(400).json({ error: "A subject and a message are required." });

  const all = await studentsWithAttendance();
  const wanted = new Set(ids);
  const targets = all.filter((s) => wanted.has(s.id));

  let sent = 0, failed = 0, skipped = 0;
  const errors = [];
  for (const s of targets) {
    if (!s.email) { skipped++; continue; }
    const vars = { firstName: s.firstName, lastName: s.lastName, name: s.name, pct: s.pct == null ? "" : s.pct, course: s.course };
    const subject = fillTemplate(subjectTpl, vars);
    const bodyText = fillTemplate(messageTpl, vars);
    const html = attendanceEmailHtml(bodyText, s.pct);
    try {
      const r = await email.sendEmail(s.email, subject, bodyText, { html });
      if (r.sent) sent++;
      else if (r.stubbed) skipped++;               // email not configured on the server
      else { failed++; if (errors.length < 20) errors.push(`${s.name || s.email}: ${r.error || "unknown error"}`); }
    } catch (e) { failed++; if (errors.length < 20) errors.push(`${s.name || s.email}: ${e.message}`); }
  }
  res.json({ sent, failed, skipped, total: targets.length, errors });
});

module.exports = router;
