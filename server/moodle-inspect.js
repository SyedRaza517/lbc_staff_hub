// Moodle inspection — READ ONLY.
//
// Prints how your Moodle is organised (categories, courses, assignments) so we can
// decide how it maps onto Staff Hub's Courses and Units before writing any sync.
//
// It calls ONLY Moodle "_get_" web-service functions. It creates nothing, changes
// nothing and deletes nothing. It also deliberately prints NO student names or email
// addresses — only counts and whether the ID fields we need are populated.
//
// ── Setup ────────────────────────────────────────────────────────────────────────
// In Moodle (as an administrator):
//   1. Site administration → Advanced features → tick "Enable web services".
//   2. Site administration → Server → Web services → Manage protocols → enable REST.
//   3. Site administration → Server → Web services → Manage tokens → create a token
//      for a service that includes the functions listed under "REQUIRED" below.
//
// Then run, from the server folder:
//   MOODLE_URL="https://vle.yourcollege.ac.uk" MOODLE_TOKEN="your-token" node moodle-inspect.js
//
// or add these two lines to server/.env and just run `node moodle-inspect.js`:
//   MOODLE_URL="https://vle.yourcollege.ac.uk"
//   MOODLE_TOKEN="your-token"
require("dotenv").config();

const BASE = (process.env.MOODLE_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.MOODLE_TOKEN || "";

// The web-service functions the sync will need. Reported as present/missing so you
// know exactly what to add to the token's service if something is not authorised.
const REQUIRED = [
  "core_webservice_get_site_info",
  "core_course_get_categories",
  "core_course_get_courses",
  "core_course_get_contents",
  "core_enrol_get_enrolled_users",
  "mod_assign_get_assignments",
  "mod_assign_get_submissions",
  "mod_assign_get_grades",
  "gradereport_user_get_grade_items",
];

async function call(wsfunction, params = {}) {
  const body = new URLSearchParams({ wstoken: TOKEN, moodlewsrestformat: "json", wsfunction });
  for (const [k, v] of Object.entries(params)) body.append(k, String(v));
  const res = await fetch(`${BASE}/webservice/rest/server.php`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error(`${wsfunction}: response was not JSON (HTTP ${res.status}). First 200 chars: ${text.slice(0, 200)}`); }
  // Moodle reports errors as 200 + an exception object.
  if (data && data.exception) throw new Error(`${wsfunction}: ${data.errorcode} — ${data.message}`);
  return data;
}

const line = (c = "─") => console.log(c.repeat(74));
const trim = (s, n = 46) => { const t = String(s ?? ""); return t.length > n ? t.slice(0, n - 1) + "…" : t; };

(async () => {
  if (!BASE || !TOKEN) {
    console.error("\n✗ MOODLE_URL and MOODLE_TOKEN are required.\n  See the setup notes at the top of this file.\n");
    process.exitCode = 1; return;
  }
  console.log(`\nInspecting ${BASE}  (read-only)\n`);

  // ── 1. Token / site check ────────────────────────────────────────────────────
  let site;
  try {
    site = await call("core_webservice_get_site_info");
  } catch (e) {
    console.error(`✗ Could not reach Moodle or the token was rejected:\n  ${e.message}\n`);
    console.error("  Check: the URL is the Moodle root (no /login), web services + REST are enabled,\n  and the token is valid and not restricted to another IP.\n");
    console.error("  A Moodle token is 32 hex characters. If you copied the whole row from\n  the tokens table you may have included the service name — use only the token.\n");
    process.exitCode = 1; return;
  }
  line();
  console.log(`SITE      ${site.sitename}`);
  console.log(`MOODLE    ${site.release || site.version}`);
  console.log(`TOKEN AS  ${site.username}  (user id ${site.userid})`);
  line();

  // ── 2. Which required functions is this token allowed to call? ───────────────
  const allowed = new Set((site.functions || []).map((f) => f.name));
  const missing = REQUIRED.filter((f) => !allowed.has(f));
  console.log("\nREQUIRED FUNCTIONS");
  for (const f of REQUIRED) console.log(`  ${allowed.has(f) ? "✓" : "✗"} ${f}`);
  if (missing.length) {
    console.log(`\n  ⚠ ${missing.length} function(s) are not authorised for this token.`);
    console.log("    Add them in Site administration → Server → Web services → External services");
    console.log("    (edit your service → Functions → Add functions), then re-run this script.");
  }

  // ── 3. Category tree ────────────────────────────────────────────────────────
  let categories = [];
  if (allowed.has("core_course_get_categories")) {
    categories = await call("core_course_get_categories");
    console.log(`\nCATEGORIES (${categories.length})   ← candidates for Staff Hub "Courses"`);
    line();
    for (const c of categories.slice(0, 40)) {
      console.log(`  id=${String(c.id).padEnd(5)} depth=${c.depth}  ${trim(c.name, 40).padEnd(41)} courses=${c.coursecount}`);
    }
    if (categories.length > 40) console.log(`  … and ${categories.length - 40} more`);
  }

  // ── 4. Courses ──────────────────────────────────────────────────────────────
  let courses = [];
  if (allowed.has("core_course_get_courses")) {
    courses = (await call("core_course_get_courses")).filter((c) => c.format !== "site");
    const catName = Object.fromEntries(categories.map((c) => [c.id, c.name]));
    console.log(`\nCOURSES (${courses.length})   ← candidates for Staff Hub "Units"`);
    line();
    console.log(`  ${"id".padEnd(6)}${"shortname".padEnd(22)}${"idnumber".padEnd(16)}${"category".padEnd(24)}fullname`);
    for (const c of courses.slice(0, 40)) {
      console.log(`  ${String(c.id).padEnd(6)}${trim(c.shortname, 20).padEnd(22)}${trim(c.idnumber || "—", 14).padEnd(16)}${trim(catName[c.categoryid] || c.categoryid, 22).padEnd(24)}${trim(c.fullname, 34)}`);
    }
    if (courses.length > 40) console.log(`  … and ${courses.length - 40} more`);
  }

  // ── 5. A sample course in detail: assignments + how students are identified ──
  const sample = courses[0];
  if (sample) {
    console.log(`\nSAMPLE COURSE  id=${sample.id}  "${trim(sample.fullname, 50)}"`);
    line();

    if (allowed.has("mod_assign_get_assignments")) {
      try {
        const r = await call("mod_assign_get_assignments", { "courseids[0]": sample.id });
        const asgns = r.courses?.[0]?.assignments || [];
        console.log(`  ASSIGNMENTS (${asgns.length})   ← candidates for Staff Hub "Assessments"`);
        for (const a of asgns.slice(0, 15)) {
          const due = a.duedate ? new Date(a.duedate * 1000).toISOString().slice(0, 10) : "—";
          console.log(`    cmid=${String(a.cmid).padEnd(6)} grade=${String(a.grade).padEnd(6)} due=${due}  ${trim(a.name, 40)}`);
        }
        if (!asgns.length) console.log("    (none — marks may live in quizzes or manual grade items instead)");
      } catch (e) { console.log(`  ASSIGNMENTS: ${e.message}`); }
    }

    if (allowed.has("gradereport_user_get_grade_items")) {
      try {
        const g = await call("gradereport_user_get_grade_items", { courseid: sample.id });
        const items = g.usergrades?.[0]?.gradeitems || [];
        console.log(`\n  GRADE ITEMS (${items.length})   ← everything gradable, incl. quizzes/manual`);
        for (const it of items.slice(0, 15)) {
          console.log(`    ${String(it.itemmodule || it.itemtype).padEnd(10)} max=${String(it.grademax).padEnd(7)} ${trim(it.itemname || "(course total)", 40)}`);
        }
      } catch (e) { console.log(`\n  GRADE ITEMS: ${e.message}`); }
    }

    // Students: print ONLY counts and field coverage — never names or emails.
    if (allowed.has("core_enrol_get_enrolled_users")) {
      try {
        const users = await call("core_enrol_get_enrolled_users", { courseid: sample.id });
        const withIdnumber = users.filter((u) => (u.idnumber || "").trim()).length;
        const withEmail = users.filter((u) => (u.email || "").trim()).length;
        console.log(`\n  ENROLLED USERS: ${users.length}`);
        console.log(`    with idnumber (student number): ${withIdnumber}/${users.length}   ← best key for matching`);
        console.log(`    with email:                     ${withEmail}/${users.length}   ← fallback key`);
        if (users.length && withIdnumber === 0) {
          console.log("    ⚠ No idnumbers are set in Moodle. We would have to match on email.");
        }
        const roles = {};
        for (const u of users) for (const r of u.roles || []) roles[r.shortname] = (roles[r.shortname] || 0) + 1;
        console.log(`    roles present: ${Object.entries(roles).map(([k, v]) => `${k}=${v}`).join(", ") || "(none reported)"}`);
      } catch (e) { console.log(`\n  ENROLLED USERS: ${e.message}`); }
    }
  }

  console.log("\n");
  line("═");
  console.log("Done — nothing was changed. Send this output back and we'll fix the mapping.");
  line("═");
  console.log("");
})().catch((e) => { console.error("\n✗ Inspection failed:", e.message, "\n"); process.exitCode = 1; });
