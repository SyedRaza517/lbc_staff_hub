// Moodle import plan — READ ONLY, and it does not touch the database either.
//
// Reads Moodle through the same parsing rules the real sync uses and prints exactly
// what it would create: which sections become units, which grade items become
// assessments, how many students it can match and how many marks are waiting.
//
// Run this BEFORE the first sync. If a unit or an assessment looks wrong here, it
// would have been wrong in the database too.
//
// From the server folder (reads MOODLE_URL / MOODLE_TOKEN from .env):
//   node moodle-plan.js
require("dotenv").config();

const BASE = (process.env.MOODLE_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.MOODLE_TOKEN || "";

// The same rules the sync applies — imported rather than copied, so this can never
// drift from what the sync actually does.
const { parseUnitSection } = require("./src/moodle");

async function call(wsfunction, params = {}) {
  const body = new URLSearchParams({ wstoken: TOKEN, moodlewsrestformat: "json", wsfunction });
  for (const [k, v] of Object.entries(params)) body.append(k, String(v));
  const res = await fetch(`${BASE}/webservice/rest/server.php`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error(`${wsfunction}: not JSON (HTTP ${res.status})`); }
  if (data && data.exception) throw new Error(`${wsfunction}: ${data.errorcode} — ${data.message}`);
  return data;
}

const clean = (s) => String(s ?? "").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").trim();
const trim = (s, n) => { const t = clean(s); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
const line = (c = "─") => console.log(c.repeat(78));
const isGradable = (it) => it.itemtype !== "course" && it.itemtype !== "category" && it.itemmodule !== "attendance";

(async () => {
  if (!BASE || !TOKEN) { console.error("\n✗ MOODLE_URL and MOODLE_TOKEN are required (see server/.env).\n"); process.exitCode = 1; return; }
  console.log(`\nImport plan for ${BASE}\nNothing is written — not to Moodle, not to the database.\n`);

  const courses = (await call("core_course_get_courses")).filter((c) => c.format !== "site");
  const total = { units: 0, assessments: 0, students: 0, marks: 0, unmatched: 0, orphanItems: 0 };

  for (const co of courses) {
    const [sections, users, grades] = await Promise.all([
      call("core_course_get_contents", { courseid: co.id }),
      call("core_enrol_get_enrolled_users", { courseid: co.id }),
      call("gradereport_user_get_grade_items", { courseid: co.id }),
    ]);
    const usergrades = grades.usergrades || [];

    console.log("\n" + "═".repeat(78));
    console.log(`COURSE  ${clean(co.fullname)}`);
    console.log("═".repeat(78));

    // Sections → units
    const unitByCmid = new Map();
    const units = [];
    const skipped = [];
    for (const sec of sections) {
      const p = parseUnitSection(sec.name);
      if (!p) { skipped.push(clean(sec.name) || `(section ${sec.section})`); continue; }
      units.push(p);
      for (const m of sec.modules || []) unitByCmid.set(m.id, p);
    }
    total.units += units.length;

    console.log(`\n  UNITS TO CREATE (${units.length})`);
    for (const u of units) console.log(`    ${u.code.padEnd(9)} no.${String(u.number).padEnd(4)} ${trim(u.name, 52)}`);
    if (skipped.length) console.log(`\n  Sections ignored (not units): ${skipped.map((s) => `"${trim(s, 26)}"`).join(", ")}`);

    // Grade items → assessments
    const items = new Map();
    for (const ug of usergrades) for (const it of ug.gradeitems || []) if (isGradable(it)) items.set(it.id, it);
    const mapped = [], orphans = [];
    for (const it of items.values()) (unitByCmid.has(it.cmid) ? mapped : orphans).push(it);
    total.assessments += mapped.length;
    total.orphanItems += orphans.length;

    console.log(`\n  ASSESSMENTS TO CREATE (${mapped.length})`);
    const byUnit = new Map();
    for (const it of mapped) {
      const u = unitByCmid.get(it.cmid);
      if (!byUnit.has(u.code)) byUnit.set(u.code, []);
      byUnit.get(u.code).push(it);
    }
    for (const [code, list] of byUnit) {
      console.log(`    ${code}`);
      for (const it of list) console.log(`      · ${trim(it.itemname, 50).padEnd(51)} out of ${it.grademax}`);
    }
    if (orphans.length) {
      console.log(`\n  ⚠ ${orphans.length} gradable item(s) sit outside any unit section and will be SKIPPED:`);
      for (const it of orphans.slice(0, 8)) console.log(`      · ${trim(it.itemname, 56)}  [${it.itemmodule || it.itemtype}]`);
      if (orphans.length > 8) console.log(`      … and ${orphans.length - 8} more`);
    }

    // Students — counts and identifier coverage only; no names, no emails.
    const studentUsers = users.filter((u) => (u.roles || []).some((r) => r.shortname === "student"));
    const withRef = studentUsers.filter((u) => clean(u.idnumber)).length;
    const withEmail = studentUsers.filter((u) => clean(u.email)).length;
    const unusable = studentUsers.filter((u) => !clean(u.idnumber) && !clean(u.email)).length;
    total.students += studentUsers.length;
    total.unmatched += unusable;

    console.log(`\n  STUDENTS (${studentUsers.length} with the student role)`);
    console.log(`    with a student number : ${withRef}/${studentUsers.length}   ← matched on this first`);
    console.log(`    with an email         : ${withEmail}/${studentUsers.length}   ← fallback`);
    if (unusable) console.log(`    ⚠ ${unusable} have neither and cannot be imported`);

    // Marks actually present
    const mappedIds = new Set(mapped.map((it) => it.id));
    let marks = 0;
    for (const ug of usergrades) {
      for (const it of ug.gradeitems || []) {
        if (mappedIds.has(it.id) && it.graderaw != null && it.graderaw !== "") marks++;
      }
    }
    total.marks += marks;
    const slots = mapped.length * studentUsers.length;
    console.log(`\n  MARKS available: ${marks}${slots ? ` of ${slots} possible (${Math.round((marks / slots) * 100)}% marked so far)` : ""}`);
  }

  console.log("\n");
  line("═");
  console.log("PLAN TOTAL");
  console.log(`  courses      ${courses.length}`);
  console.log(`  units        ${total.units}`);
  console.log(`  assessments  ${total.assessments}`);
  console.log(`  students     ${total.students}${total.unmatched ? `  (${total.unmatched} unusable)` : ""}`);
  console.log(`  marks        ${total.marks}`);
  if (total.orphanItems) console.log(`  ⚠ ${total.orphanItems} gradable item(s) outside any unit section will be skipped`);
  line("═");
  console.log("Nothing was changed. If this looks right, run the sync from the app.\n");
})().catch((e) => { console.error("\n✗ Plan failed:", e.message, "\n"); process.exitCode = 1; });
