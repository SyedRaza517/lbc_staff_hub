// READ ONLY — when did each intake start, and when was each unit actually taught?
//
// Two candidate anchors for "is this unit current or finished":
//   1. the Moodle course's own start/end dates
//   2. the real submission and marking dates on each unit's assessments
// Prints both so we can see which one is trustworthy. No student names.
//
//   node moodle-timeline.js
require("dotenv").config();
const { parseUnitSection } = require("./src/moodle");

const BASE = (process.env.MOODLE_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.MOODLE_TOKEN || "";

async function call(wsfunction, params = {}) {
  const body = new URLSearchParams({ wstoken: TOKEN, moodlewsrestformat: "json", wsfunction });
  for (const [k, v] of Object.entries(params)) body.append(k, String(v));
  const res = await fetch(`${BASE}/webservice/rest/server.php`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
  });
  const data = JSON.parse(await res.text());
  if (data && data.exception) throw new Error(`${data.errorcode} — ${data.message}`);
  return data;
}

const d = (t) => (t ? new Date(Number(t) * 1000).toISOString().slice(0, 10) : "—");
const clean = (s) => String(s ?? "").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").trim();
const TODAY = new Date().toISOString().slice(0, 10);

(async () => {
  const courses = (await call("core_course_get_courses")).filter((c) => c.format !== "site");
  console.log(`\nToday is ${TODAY}\n`);

  for (const co of courses) {
    console.log(`\n${"═".repeat(76)}\n${clean(co.fullname)}\n${"═".repeat(76)}`);
    console.log(`  Moodle course dates : start ${d(co.startdate)}   end ${d(co.enddate)}`);

    const [sections, grades, users] = await Promise.all([
      call("core_course_get_contents", { courseid: co.id }),
      call("gradereport_user_get_grade_items", { courseid: co.id }),
      call("core_enrol_get_enrolled_users", { courseid: co.id }),
    ]);
    const usergrades = grades.usergrades || [];
    const students = users.filter((u) => (u.roles || []).some((r) => r.shortname === "student"));

    // cmid → unit, so a grade item can be traced to its unit.
    const unitByCmid = new Map();
    const unitCodes = [];
    for (const sec of sections) {
      const p = parseUnitSection(sec.name);
      if (!p) continue;
      unitCodes.push(p.code);
      for (const m of sec.modules || []) unitByCmid.set(m.id, p.code);
    }

    // Per unit: how many assessments, and the real span of submission/marking dates.
    const per = new Map(unitCodes.map((c) => [c, { items: new Set(), sub: [], grd: [], marks: 0, studentsSeen: new Set() }]));
    for (const ug of usergrades) {
      for (const it of ug.gradeitems || []) {
        if (it.itemtype === "course" || it.itemtype === "category" || it.itemmodule === "attendance") continue;
        const code = unitByCmid.get(it.cmid);
        if (!code || !per.has(code)) continue;
        const u = per.get(code);
        u.items.add(it.id);
        u.studentsSeen.add(ug.userid);
        if (it.graderaw != null && it.graderaw !== "") u.marks++;
        if (it.gradedatesubmitted) u.sub.push(Number(it.gradedatesubmitted));
        if (it.gradedategraded) u.grd.push(Number(it.gradedategraded));
      }
    }

    console.log(`\n  ${"unit".padEnd(9)}${"assess".padEnd(8)}${"marks".padEnd(7)}${"students".padEnd(10)}submitted range          last marked`);
    console.log(`  ${"─".repeat(74)}`);
    for (const code of unitCodes) {
      const u = per.get(code);
      const s = u.sub.sort((a, b) => a - b);
      const g = u.grd.sort((a, b) => a - b);
      const range = s.length ? `${d(s[0])} → ${d(s[s.length - 1])}` : "—";
      console.log(`  ${code.padEnd(9)}${String(u.items.size).padEnd(8)}${String(u.marks).padEnd(7)}${String(u.studentsSeen.size).padEnd(10)}${range.padEnd(25)}${g.length ? d(g[g.length - 1]) : "—"}`);
    }
    console.log(`\n  students with the student role: ${students.length}`);
    console.log(`  units with NO assessments     : ${unitCodes.filter((c) => per.get(c).items.size === 0).join(", ") || "none"}`);
  }
  console.log("\nNothing was changed.\n");
})().catch((e) => { console.error("\n✗ Failed:", e.message, "\n"); process.exitCode = 1; });
