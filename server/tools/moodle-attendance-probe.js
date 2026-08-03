// READ ONLY — can we read attendance out of Moodle, and what shape is it?
//
// Answers three things before any attendance work starts:
//   1. Which mod_attendance web-service functions this token is allowed to call.
//   2. What attendance activities exist per course, and how many sessions each has.
//   3. The date range of those sessions — which is what tells us whether a unit is
//      still running or already finished.
//
// Prints no student names. Run from the server folder:  node moodle-attendance-probe.js
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

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

const ATTENDANCE_FNS = [
  "mod_attendance_get_attendances_by_courses",
  "mod_attendance_get_sessions",
  "mod_attendance_get_session",
  "mod_attendance_get_attendance",
  "mod_attendance_get_courses_with_today_sessions",
  "mod_attendance_get_student_attendance_stats",
  "mod_attendance_get_student_sessions_by_course",
  "mod_attendance_update_user_status",
];
const d = (t) => (t ? new Date(Number(t) * 1000).toISOString().slice(0, 10) : "—");
const clean = (s) => String(s ?? "").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").trim();

(async () => {
  if (!BASE || !TOKEN) { console.error("\nMOODLE_URL and MOODLE_TOKEN are required.\n"); process.exitCode = 1; return; }

  const site = await call("core_webservice_get_site_info");
  const allowed = new Set((site.functions || []).map((f) => f.name));
  console.log(`\nATTENDANCE WEB SERVICES on ${BASE}\n${"─".repeat(72)}`);
  for (const f of ATTENDANCE_FNS) console.log(`  ${allowed.has(f) ? "yes" : " no"}  ${f}`);
  const canRead = allowed.has("mod_attendance_get_sessions") || allowed.has("mod_attendance_get_attendances_by_courses");
  if (!canRead) {
    console.log(`\n  ⚠ This token cannot read attendance. Add the mod_attendance functions to the`);
    console.log(`    token's external service in Moodle (Site administration → Server →`);
    console.log(`    Web services → External services → Functions), then re-run this.`);
  }

  const courses = (await call("core_course_get_courses")).filter((c) => c.format !== "site");
  for (const co of courses) {
    console.log(`\n${"═".repeat(72)}\n${clean(co.fullname)}\n${"═".repeat(72)}`);

    // Find the attendance activities via course contents (works without mod_attendance).
    const sections = await call("core_course_get_contents", { courseid: co.id });
    const acts = [];
    for (const s of sections) for (const m of s.modules || []) if (m.modname === "attendance") acts.push({ ...m, section: clean(s.name) });
    console.log(`  attendance activities: ${acts.length}`);
    for (const a of acts) console.log(`    cmid=${a.id}  in "${a.section}"  —  ${clean(a.name)}`);

    if (!acts.length || !canRead) continue;

    for (const a of acts) {
      try {
        const sessions = await call("mod_attendance_get_sessions", { attendanceid: a.instance ?? a.id });
        const dates = sessions.map((s) => Number(s.sessdate)).filter(Boolean).sort((x, y) => x - y);
        console.log(`\n    "${clean(a.name)}" — ${sessions.length} session(s)`);
        if (dates.length) console.log(`      range: ${d(dates[0])} → ${d(dates[dates.length - 1])}`);
        const withMarks = sessions.filter((s) => (s.attendance_log && Object.keys(s.attendance_log).length) || s.attendancelog);
        console.log(`      sessions carrying marks: ${withMarks.length}`);
        const sample = sessions[0];
        if (sample) console.log(`      sample keys: ${Object.keys(sample).join(", ")}`);
        // Does a session say which unit/group it belongs to? That is the crux of
        // mapping Moodle attendance onto Staff Hub units.
        if (sample) {
          for (const k of ["description", "groupid", "sessdate", "duration", "lasttaken", "statusesid"]) {
            if (k in sample) console.log(`        ${k}: ${JSON.stringify(sample[k]).slice(0, 90)}`);
          }
        }
      } catch (e) { console.log(`      could not read sessions: ${e.message}`); }
    }
  }
  console.log("\nNothing was changed.\n");
})().catch((e) => { console.error("\n✗ Probe failed:", e.message, "\n"); process.exitCode = 1; });
