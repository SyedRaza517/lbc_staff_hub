// READ ONLY — what does Moodle's attendance data actually look like, and can it be
// mapped onto Staff Hub's per-unit registers?
//
// The hard question is not "can we read it" (we can) but "which UNIT does a Moodle
// session belong to". Moodle has ONE attendance activity per intake, not one per unit,
// so the unit has to come from somewhere inside the session — most likely its
// description. This prints enough to answer that.
//
// Prints no student names. Run from server/:  node tools/moodle-attendance-shape.js
require("dotenv").config();

const URL = (process.env.MOODLE_URL || "").replace(/\/$/, "");
const TOKEN = process.env.MOODLE_TOKEN;
if (!URL || !TOKEN) { console.log("MOODLE_URL / MOODLE_TOKEN not set"); process.exit(1); }

async function call(wsfunction, params = {}) {
  const body = new URLSearchParams({ wstoken: TOKEN, moodlewsrestformat: "json", wsfunction });
  for (const [k, v] of Object.entries(params)) body.append(k, v);
  const r = await fetch(`${URL}/webservice/rest/server.php`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
  });
  return r.json();
}

const day = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);
const hhmm = (ts) => new Date(ts * 1000).toISOString().slice(11, 16);

(async () => {
  const courses = await call("core_course_get_courses");
  const attendanceCmids = [];
  for (const c of courses) {
    if (!c.id) continue;
    const contents = await call("core_course_get_contents", { courseid: c.id });
    for (const sec of contents || []) {
      for (const m of sec.modules || []) {
        if (m.modname === "attendance") attendanceCmids.push({ course: c.fullname, courseid: c.id, cmid: m.id, instance: m.instance ?? m.id, name: m.name });
      }
    }
  }

  for (const a of attendanceCmids) {
    console.log("\n" + "=".repeat(76));
    console.log(a.course);
    console.log("  activity:", a.name, `(cmid ${a.cmid}, instance ${a.instance})`);
    const res = await call("mod_attendance_get_sessions", { attendanceid: a.instance });
    if (!Array.isArray(res)) { console.log("  cannot read:", JSON.stringify(res).slice(0, 160)); continue; }

    const withMarks = res.filter((s) => (s.attendance_log || []).length);
    console.log(`  ${res.length} sessions, ${withMarks.length} carrying marks`);

    // 1. The status set — this is what maps onto Staff Hub's P / L / E / A.
    const statuses = new Map();
    for (const s of res) for (const st of s.statuses || []) statuses.set(st.id, `${st.acronym} = ${st.description} (grade ${st.grade}/${st.studentavailability ?? "-"})`);
    console.log("\n  STATUSES available:");
    for (const [id, label] of statuses) console.log(`    ${String(id).padEnd(5)} ${label}`);

    // 2. Descriptions — the only per-session free text, so the likeliest place a unit
    //    is recorded. If these are unit codes, an import can be mapped; if they are all
    //    "Regular class session", the unit is simply not in the data.
    const descs = new Map();
    for (const s of res) {
      const d = String(s.description || "").replace(/<[^>]*>/g, "").trim() || "(blank)";
      descs.set(d, (descs.get(d) || 0) + 1);
    }
    console.log(`\n  DESCRIPTIONS (${descs.size} distinct) — does a unit appear here?`);
    [...descs.entries()].sort((x, y) => y[1] - x[1]).slice(0, 14)
      .forEach(([d, n]) => console.log(`    ${String(n).padStart(4)} x  ${JSON.stringify(d).slice(0, 62)}`));

    // 3. Are sessions split by GROUP? A group could stand in for a unit or cohort.
    const groups = new Map();
    for (const s of res) groups.set(s.groupid, (groups.get(s.groupid) || 0) + 1);
    console.log("\n  GROUPS used:", [...groups.entries()].map(([g, n]) => `groupid ${g}: ${n}`).join(", "));

    // 4. One marked session in full, so the log shape is unambiguous. No names.
    const sample = withMarks[0];
    if (sample) {
      console.log("\n  SAMPLE marked session:");
      console.log("    date:", day(sample.sessdate), hhmm(sample.sessdate), `(${sample.duration / 3600}h)`);
      console.log("    marks:", sample.attendance_log.length, "| enrolled users listed:", (sample.users || []).length);
      const log = sample.attendance_log[0];
      console.log("    attendance_log[0] keys:", Object.keys(log).join(", "));
      console.log("    attendance_log[0]:", JSON.stringify({ ...log, remarks: log.remarks ? "(text)" : "" }));
      const tally = {};
      for (const l of sample.attendance_log) tally[l.statusid] = (tally[l.statusid] || 0) + 1;
      console.log("    status tally for this session:", JSON.stringify(tally));
      if ((sample.users || []).length) console.log("    users[0] keys:", Object.keys(sample.users[0]).join(", "));
    }
  }
  console.log("\nNothing was changed.");
})();
