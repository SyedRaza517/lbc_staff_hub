// Automated student-attendance emails — the compute + email-building core.
//
// This module turns "who is enrolled, and how are they attending this semester"
// into a set of ready-to-send, per-student emails, and sends them. It deliberately
// holds no HTTP/route logic: a route (or a scheduled job) resolves the semester and
// the template config, calls the functions here, and reports the result.
//
// Percentages ALWAYS come from summariseCounts() in ./attendance so this figure
// matches the register views, the student's own app and the executive dashboard —
// one student, one attendance number, everywhere.
//
// The attendance bands (which % lands in which template) and the default templates
// live in ./attendanceBands, which is loaded here and used as the defensive
// fallback whenever the caller passes a partial config.

const prisma = require("./db");
const { summariseCounts } = require("./attendance");
const email = require("./email");
const bands = require("./attendanceBands");
const mailFrom = require("./mailFrom");

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

// Inline-escape a value for a single-quoted SQL literal. Copied from the HND
// /attendance handler: the counting happens IN POSTGRES (grouping millions of
// marks in Node OOM-crashes at scale), and every value here comes from our own
// Semester rows — never user input — so inlining is safe.
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

// HTML-escape any student/config-derived text before it goes into the HTML email.
const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// "<Month YYYY>" for a given date — the human {period} fallback when a semester
// has no name of its own.
const monthYearLabel = (d = new Date()) => `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

// The three-colour attendance palette, shared by the badge and the module table so
// a single threshold governs the whole email: green >= 60, amber 40–59, red < 40.
function badgeColours(pct) {
  if (pct >= 60) return { bg: "#ecfdf5", fg: "#047857", border: "#a7f3d0" };
  if (pct >= 40) return { bg: "#fffbeb", fg: "#b45309", border: "#fde68a" };
  return { bg: "#fef2f2", fg: "#b91c1c", border: "#fecaca" };
}
// Just the foreground colour, for the per-module percentage cell.
function pctColour(pct) {
  if (pct == null) return "#64748b";
  if (pct >= 60) return "#047857";
  if (pct >= 40) return "#b45309";
  return "#b91c1c";
}

// ---------------------------------------------------------------------------
// 1) currentTerm — derived from the registers, not a separate setting
// ---------------------------------------------------------------------------

// A "Month YYYY" or "Month–Month YYYY" label for a date range (both "YYYY-MM-DD").
function rangeLabel(start, end) {
  if (!start) return monthYearLabel();
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end || start}T00:00:00Z`);
  const sm = MONTHS[s.getUTCMonth()], em = MONTHS[e.getUTCMonth()];
  if (s.getUTCFullYear() === e.getUTCFullYear() && sm === em) return `${sm} ${s.getUTCFullYear()}`;
  if (s.getUTCFullYear() === e.getUTCFullYear()) return `${sm}–${em} ${s.getUTCFullYear()}`;
  return `${sm} ${s.getUTCFullYear()}–${em} ${e.getUTCFullYear()}`;
}

// The current teaching term, taken FROM THE REGISTERS: the units running today
// (Unit.startDate <= today <= Unit.endDate — the admin-set teaching window that also
// drives register generation). Their combined date span and unit set define "this term".
// If no unit has teaching dates yet, fall back to a manually-set current Semester (scope by
// date only). Returns { name, start, end, unitIds } or null.
//   unitIds — the running units; attendance is restricted to these. null in the Semester
//   fallback, where we scope by the date range instead.
async function currentTerm() {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const running = await prisma.unit.findMany({
    where: { startDate: { not: null, lte: today }, endDate: { not: null, gte: today } },
    select: { id: true, startDate: true, endDate: true, term: { select: { name: true } } },
  });
  if (running.length) {
    const starts = running.map((u) => u.startDate).sort();
    const ends = running.map((u) => u.endDate).sort();
    const start = starts[0], end = ends[ends.length - 1];
    // If every running unit shares one dated Term, use its name; otherwise a date range.
    const termNames = [...new Set(running.map((u) => u.term && u.term.name).filter(Boolean))];
    const name = termNames.length === 1 ? termNames[0] : rangeLabel(start, end);
    return { name, start, end, unitIds: running.map((u) => u.id) };
  }

  // Fallback: an admin-set current Semester whose [start, end] contains today.
  const sems = await prisma.semester.findMany({
    where: { start: { lte: today }, end: { gte: today } },
    orderBy: { start: "desc" },
  });
  const s = sems[0];
  if (s) return { name: s.name, start: s.start, end: s.end, unitIds: null };
  return null;
}

// ---------------------------------------------------------------------------
// 2) computeCurrentTermAttendance
// ---------------------------------------------------------------------------

// Build the per-student attendance picture for the current term:
//   { term, period, students: [ { …, pct, bandKey, bandLabel, modules[] } ] }
//
// `term` = { name, start, end, unitIds } from currentTerm(). Only CURRENTLY-enrolled units
// count (the SQL joins Enrolment), and — when term.unitIds is set — only the units running
// this term, so a figure can't be dragged by a unit the student has left or that isn't part
// of this term. A student with no marks this term is still returned, but with pct null,
// modules [] and bandKey null, so the caller can simply skip them.
async function computeCurrentTermAttendance(term) {
  const semester = term; // same shape { start, end, name }; term.unitIds may restrict units
  const unitFilter = term.unitIds ? new Set(term.unitIds) : null;
  // Active students, with their programme (cohort → course) and current enrolments.
  const students = await prisma.student.findMany({
    where: { active: true },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    include: {
      cohort: { include: { course: { select: { name: true } } } },
      enrolments: { select: { unitId: true } },
    },
  });

  // unitId -> { code, name, course } for labelling the module list and deriving the
  // student's course/programme from the units they actually take.
  const unitRows = await prisma.unit.findMany({ select: { id: true, code: true, name: true, course: { select: { name: true } } } });
  const unitMap = new Map(unitRows.map((u) => [u.id, { code: u.code, name: u.name, course: u.course && u.course.name }]));

  // One aggregate row per (student, unit) — the four status counts, scoped to the
  // semester's dates and joined to Enrolment so only current enrolments are counted.
  const perSU = await prisma.$queryRawUnsafe(`
    SELECT am."studentId" sid, se."unitId" mid,
      count(*) FILTER (WHERE am.status='P')::int p,
      count(*) FILTER (WHERE am.status='L')::int l,
      count(*) FILTER (WHERE am.status='E')::int e,
      count(*) FILTER (WHERE am.status='A')::int a
    FROM "AttendanceMark" am
    JOIN "HndSession" se ON se.id = am."sessionId"
    JOIN "Enrolment" en ON en."studentId" = am."studentId" AND en."unitId" = se."unitId"
    WHERE se.date >= ${q(semester.start)} AND se.date <= ${q(semester.end)}
    GROUP BY am."studentId", se."unitId"`);

  // studentId -> Map(unitId -> { p, l, e, a }).
  const index = new Map();
  for (const r of perSU) {
    if (!index.has(r.sid)) index.set(r.sid, new Map());
    index.get(r.sid).set(r.mid, r);
  }

  const outStudents = students.map((s) => {
    const per = index.get(s.id) || new Map();
    // The units the student is actually enrolled on — the SQL already restricts rows
    // to these, but we intersect again defensively.
    const enrolledIds = new Set((s.enrolments || []).map((e) => e.unitId));

    const modules = [];
    const courseNames = new Set();
    const acc = { P: 0, L: 0, E: 0, A: 0 };
    for (const [unitId, c] of per) {
      if (!enrolledIds.has(unitId)) continue; // not currently enrolled → ignore
      if (unitFilter && !unitFilter.has(unitId)) continue; // not a unit running this term
      const sum = summariseCounts(c.p, c.l, c.e, c.a);
      const u = unitMap.get(unitId) || { code: "", name: "" };
      if (u.course) courseNames.add(u.course);
      modules.push({ unitId, code: u.code, name: u.name, pct: sum.pct, marked: sum.marked });
      acc.P += c.p; acc.L += c.l; acc.E += c.e; acc.A += c.a;
    }
    // Module list reads in code order.
    modules.sort((a, b) => String(a.code).localeCompare(String(b.code)));

    const overall = summariseCounts(acc.P, acc.L, acc.E, acc.A);
    const pct = overall.pct; // 0..100 (one decimal) or null when no marks this term
    const band = pct == null ? null : bands.bandForPct(pct);

    return {
      id: s.id,
      firstName: s.firstName,
      lastName: s.lastName,
      name: `${s.firstName} ${s.lastName}`,
      email: s.email,
      // Course comes from the units the student is actually taking this term (many students
      // have no cohort→course link); fall back to the cohort's course if there is one.
      programme: [...courseNames].filter(Boolean).join(", ") || s.cohort?.course?.name || "",
      pct,
      bandKey: band ? band.key : null,
      bandLabel: band ? band.label : null,
      modules,
    };
  });

  return {
    term: { name: term.name, start: term.start, end: term.end },
    period: term.name || monthYearLabel(),
    students: outStudents,
  };
}

// ---------------------------------------------------------------------------
// 3) buildEmailFor
// ---------------------------------------------------------------------------

// Render the plain-text module list that replaces the {modules} token in the TEXT
// body. Empty string when the student has no modules to report.
function modulesToText(modules) {
  if (!modules || !modules.length) return "";
  const lines = modules.map(
    (m) => `• ${m.code} ${m.name} — ${m.pct == null ? "n/a" : m.pct}%`
  );
  return `Your attendance by module this term:\n${lines.join("\n")}`;
}

// Render the HTML module block that replaces the {modules} token in the HTML body:
// a heading and a bordered table of module name + percentage (coloured per band).
function modulesToHtml(modules) {
  if (!modules || !modules.length) return "";
  const rows = modules
    .map((m) => {
      const colour = pctColour(m.pct);
      const val = m.pct == null ? "n/a" : `${esc(m.pct)}%`;
      return `<tr>
          <td style="padding:8px 12px;border:1px solid #e2e8f0;font-size:13px;color:#334155">${esc(m.code)} ${esc(m.name)}</td>
          <td style="padding:8px 12px;border:1px solid #e2e8f0;font-size:13px;font-weight:700;text-align:right;color:${colour};white-space:nowrap">${val}</td>
        </tr>`;
    })
    .join("");
  return `<div style="margin:16px 0">
      <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#0f172a">Your attendance by module this term</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">${rows}</table>
    </div>`;
}

// Wrap a rendered HTML body in the branded London Brookes College email shell.
function htmlShell(bodyHtml, pct) {
  // Attendance badge — omitted entirely when there is no figure to show.
  let badge = "";
  if (pct != null) {
    const c = badgeColours(pct);
    badge = `<div style="margin:0 0 16px">
        <span style="display:inline-block;padding:6px 14px;border-radius:999px;background:${c.bg};color:${c.fg};border:1px solid ${c.border};font-size:13px;font-weight:700">${esc(pct)}% attendance</span>
      </div>`;
  }
  return `<div style="margin:0;padding:24px;background:#eef1f6;font-family:'Segoe UI',system-ui,-apple-system,sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(15,23,42,.08)">
    <div style="background:linear-gradient(135deg,#1a3a8f,#9e1b32);padding:20px 24px">
      <p style="margin:0 0 2px;color:rgba(255,255,255,.7);font-size:11px;letter-spacing:.18em">STUDENT ATTENDANCE</p>
      <p style="margin:0;color:#fff;font-size:18px;font-weight:800">London Brookes College</p>
    </div>
    <div style="padding:24px">
      ${badge}
      <div style="font-size:14px;line-height:1.6;color:#334155">${bodyHtml}</div>
    </div>
    <div style="padding:14px 24px;background:#f8fafc;border-top:1px solid #e2e8f0">
      <p style="margin:0;font-size:11px;color:#94a3b8">London Brookes College · 42 The Burroughs, Hendon, London NW4 4AP · info@londonbrookescollege.co.uk</p>
    </div>
  </div>
</div>`;
}

// Build the email for one student. Returns { subject, text, html }, or null when
// there is nothing to send (the student has no band — i.e. no attendance figure).
//
// config = { values, templates, respondDays }; opts = { period, respondByDate }.
// Any missing piece falls back to the module defaults so a partial config still works.
function buildEmailFor(student, config = {}, opts = {}) {
  // No band → no attendance figure this term → nothing to send.
  if (!student || student.bandKey == null) return null;

  const defTemplates = bands.DEFAULT_TEMPLATES || {};
  const template = (config.templates && config.templates[student.bandKey]) || defTemplates[student.bandKey];
  if (!template) return null; // no template defined for this band

  // Institution tokens first, then the per-student tokens (which win on any clash).
  const vars = {
    ...(config.values || bands.DEFAULT_VALUES || {}),
    firstName: student.firstName || "",
    lastName: student.lastName || "",
    name: student.name || "",
    pct: student.pct == null ? "" : student.pct,
    period: opts.period || "",
    programme: student.programme || "",
    // A rough "you've missed about N in 10 classes" figure for the message body.
    missedRate: student.pct == null ? "" : Math.max(0, Math.round((100 - student.pct) / 10)),
    respondDays: config.respondDays != null ? config.respondDays : 5,
    respondByDate: opts.respondByDate || "",
  };

  const subject = bands.fillTemplate(template.subject || "", vars);
  const bodyTemplate = String(template.body || "");

  // --- Plain-text body ---
  // Replace {modules} with the plain-text list FIRST (so fillTemplate's handling of
  // unknown tokens can't blank it), then fill the remaining tokens.
  const textWithModules = bodyTemplate.split("{modules}").join(modulesToText(student.modules));
  const text = bands.fillTemplate(textWithModules, vars);

  // --- HTML body ---
  // Split on {modules} and render each surrounding segment as escaped, token-filled
  // text with newlines → <br>, then stitch the HTML module table in between. Doing it
  // per-segment keeps the \n→<br> conversion off the table's own markup.
  const modulesHtml = modulesToHtml(student.modules);
  const bodyHtml = bodyTemplate
    .split("{modules}")
    .map((seg) => esc(bands.fillTemplate(seg, vars)).replace(/\n/g, "<br>"))
    .join(modulesHtml);
  const html = htmlShell(bodyHtml, student.pct == null ? null : student.pct);

  return { subject, text, html };
}

// ---------------------------------------------------------------------------
// 4) sendToStudents
// ---------------------------------------------------------------------------

// Send an email to each student that has one to receive. Returns a tally:
//   { sent, failed, skipped, total, errors[] }
// Skipped covers no email address, no band, no template — and the console-stub mode
// (email not configured), which is a non-failure. Failures are collected (capped at
// 25) as "<name>: <error>" for the caller to surface.
async function sendToStudents(students, config = {}, opts = {}) {
  const list = students || [];
  const result = { sent: 0, failed: 0, skipped: 0, total: list.length, errors: [] };

  for (const student of list) {
    if (!student.email) { result.skipped++; continue; }
    if (student.bandKey == null) { result.skipped++; continue; }

    const built = buildEmailFor(student, config, opts);
    if (!built) { result.skipped++; continue; }

    const r = await email.sendEmail(student.email, built.subject, built.text, { html: built.html, from: mailFrom.attendance });
    if (r.sent) {
      result.sent++;
    } else if (r.stubbed) {
      // Email isn't configured — printed to the console, not a real failure.
      result.skipped++;
    } else {
      result.failed++;
      if (result.errors.length < 25) {
        result.errors.push(`${student.name || student.email}: ${r.error}`);
      }
    }
  }

  return result;
}

module.exports = { currentTerm, computeCurrentTermAttendance, buildEmailFor, sendToStudents };
